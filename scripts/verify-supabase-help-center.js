// supabase-verify-help-center.js — the Help Center's backend: the public door, the write path,
// the server-side publish checklist, and the draft/published separation (2026-09-23, Phase 1).
//
// ★★ PART 1 IS THE POINT OF THIS FILE AND MUST NEVER BE WEAKENED. The Help Center's one real
// risk is a draft leaking publicly. The migration's header says no anon grant or policy may ever
// be added to `help_articles` — but a comment only EXPLAINS the rule, it cannot enforce it. These
// assertions do. If someone later adds `grant select ... to anon` or an anon policy "to make
// something work", the error code changes and Part 1 fails by name instead of a draft going live.
//
// Two mechanisms are checked because they are genuinely different, and each covers a hole the
// other does not:
//   * anon has NO GRANT at all            -> PostgREST 42501 "permission denied for table"
//   * a signed-in NON-ADMIN has the grant -> the admin-only RLS policy returns an EMPTY set
// A change that breaks either one is a real leak, and only one of them is about RLS.
//
// Usage (from scripts/):  node supabase-verify-help-center.js
const { createClient } = require('@supabase/supabase-js');
const { execSync } = require('node:child_process');
const { runVerifyMain } = require('./lib/run-verify.mjs');

let passed = 0, failed = 0;
function check(label, ok, detail) {
  if (ok) { passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (detail === undefined ? '' : ' — ' + detail)); }
}
function section(t) { console.log('\n' + t); }

function stack() {
  const raw = execSync('supabase status -o json', { cwd: '..', encoding: 'utf8' });
  const st = JSON.parse(raw.slice(raw.indexOf('{')));
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(st.API_URL)) {
    throw new Error('refusing a non-local API_URL: ' + st.API_URL);
  }
  return st;
}

const SUF = Math.random().toString(36).slice(2, 8);
const DRAFT_SLUG = 'hc-draft-' + SUF;
const LIVE_SLUG = 'hc-live-' + SUF;

async function main() {
  const st = stack();
  const url = st.API_URL, anonKey = st.ANON_KEY;
  const admin = createClient(url, st.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  // ---- sessions -----------------------------------------------------------------------------
  const pmClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: pmSession, error: pmErr } = await pmClient.auth.signInWithPassword({
    email: 'pm@marketswave.local', password: 'MarketswavePM-Local-2026!',
  });
  if (pmErr) throw new Error('could not sign in the local bootstrap PM: ' + pmErr.message);
  const pmToken = pmSession.session.access_token;

  // A real signed-in NON-ADMIN, for the second denial mechanism.
  const plainEmail = 'hc-plain-' + SUF + '@marketswave.test';
  const { data: plainUser, error: plainErr } = await admin.auth.admin.createUser({
    email: plainEmail, password: 'HelpCenter-Plain-2026!', email_confirm: true,
  });
  if (plainErr) throw new Error('could not create the non-admin probe user: ' + plainErr.message);
  const plainClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  await plainClient.auth.signInWithPassword({ email: plainEmail, password: 'HelpCenter-Plain-2026!' });

  const call = async (fn, body, token) => {
    const res = await fetch(url + '/functions/v1/' + fn, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
      body: JSON.stringify(body || {}),
    });
    let parsed = null; try { parsed = await res.json(); } catch { /* no body */ }
    return { status: res.status, body: parsed };
  };
  // Raw PostgREST as a genuinely anonymous visitor — the apikey alone, no session.
  const anonGet = async (path) => {
    const res = await fetch(url + '/rest/v1/' + path, { headers: { apikey: anonKey } });
    let parsed = null; try { parsed = await res.json(); } catch { /* no body */ }
    return { status: res.status, body: parsed };
  };

  try {
    // =========================================================================================
    section('1. THE PUBLIC DOOR — a draft must be unreachable by every anonymous path');
    // =========================================================================================
    // Seed one genuine draft and one genuine published article, directly, so Part 1 is testing
    // the doors rather than an empty table.
    await admin.from('help_articles').insert([
      {
        slug: DRAFT_SLUG, topic_id: 'adding-money', title: 'A draft nobody may read',
        question: 'Can an anonymous visitor read this?', lede: 'SECRET-DRAFT-LEDE-' + SUF,
        blocks: [{ type: 'p', runs: [{ t: 'SECRET-DRAFT-BODY-' + SUF }] }],
      },
      {
        slug: LIVE_SLUG, topic_id: 'adding-money', title: 'A draft title that is NOT live',
        lede: 'draft lede', blocks: [],
        pub_topic_id: 'adding-money', pub_title: 'The published title',
        pub_question: 'q', pub_lede: 'the published lede',
        pub_blocks: [{ type: 'p', runs: [{ t: 'published body' }] }],
        published_at: new Date().toISOString(),
      },
    ]);

    const anonTable = await anonGet('help_articles?select=slug,title,lede');
    check('★ GUARD: anon reading the help_articles TABLE is refused with 42501 (no grant exists). ' +
      'If this ever starts passing as a 200, someone has granted anon access and drafts are public',
      anonTable.status >= 400 && anonTable.body && anonTable.body.code === '42501',
      JSON.stringify({ status: anonTable.status, code: anonTable.body && anonTable.body.code }));

    const plainTable = await plainClient.from('help_articles').select('slug,lede');
    check('★ GUARD: a signed-in NON-ADMIN reads the table as an EMPTY set (the grant exists for ' +
      'authenticated; the admin-only RLS policy is what denies) — a different mechanism from the line above',
      !plainTable.error && Array.isArray(plainTable.data) && plainTable.data.length === 0,
      JSON.stringify({ error: plainTable.error && plainTable.error.message, rows: plainTable.data && plainTable.data.length }));

    const adminTable = await admin.from('help_articles').select('slug').in('slug', [DRAFT_SLUG, LIVE_SLUG]);
    check('NON-VACUITY: a manager CAN read both rows, so the two denials above are about access, ' +
      'not about an empty table', !adminTable.error && adminTable.data.length === 2,
      JSON.stringify(adminTable.data && adminTable.data.map((r) => r.slug)));

    const anonView = await anonGet('help_articles_public?select=slug,title');
    const viewSlugs = Array.isArray(anonView.body) ? anonView.body.map((r) => r.slug) : [];
    check('anon CAN read the published-only view, and the published article is in it',
      anonView.status === 200 && viewSlugs.indexOf(LIVE_SLUG) !== -1, JSON.stringify(viewSlugs.slice(0, 5)));
    check('★ the draft is NOT in the view', viewSlugs.indexOf(DRAFT_SLUG) === -1, JSON.stringify(viewSlugs.slice(0, 5)));

    const byName = await anonGet('help_articles_public?slug=eq.' + DRAFT_SLUG + '&select=slug,title,lede');
    check('★ asking the view for the draft BY NAME returns nothing — not a 403 that confirms it exists, ' +
      'just an empty list', byName.status === 200 && Array.isArray(byName.body) && byName.body.length === 0,
      JSON.stringify(byName.body));

    const draftCol = await anonGet('help_articles_public?select=slug,draft_dirty');
    check('★ a DRAFT-ONLY column is not selectable through the view at all',
      draftCol.status >= 400, JSON.stringify({ status: draftCol.status, code: draftCol.body && draftCol.body.code }));

    const liveRow = await anonGet('help_articles_public?slug=eq.' + LIVE_SLUG + '&select=title,lede');
    const lr = Array.isArray(liveRow.body) && liveRow.body[0];
    check('★ the view serves the PUBLISHED title and lede, never the draft ones sitting in the same row',
      !!lr && lr.title === 'The published title' && lr.lede === 'the published lede', JSON.stringify(lr));

    const secretHunt = await anonGet('help_articles_public?select=*&limit=200');
    const dump = JSON.stringify(secretHunt.body || []);
    check('★ no draft text appears anywhere in a full anonymous dump of the view',
      dump.indexOf('SECRET-DRAFT-LEDE-' + SUF) === -1 && dump.indexOf('SECRET-DRAFT-BODY-' + SUF) === -1,
      'dump length ' + dump.length);

    // =========================================================================================
    section('2. THE WRITE PATH — admin only, validated');
    // =========================================================================================
    const unauth = await call('save-help-article', { title: 'x' }, null);
    check('save-help-article refuses an unauthenticated caller (401)', unauth.status === 401, String(unauth.status));
    const plainToken = (await plainClient.auth.getSession()).data.session.access_token;
    const nonAdmin = await call('save-help-article', { title: 'x' }, plainToken);
    check('save-help-article refuses a signed-in non-admin (403)', nonAdmin.status === 403, String(nonAdmin.status));
    for (const fn of ['publish-help-article', 'unpublish-help-article']) {
      const a = await call(fn, { id: '00000000-0000-0000-0000-000000000000' }, null);
      const b = await call(fn, { id: '00000000-0000-0000-0000-000000000000' }, plainToken);
      check(fn + ' refuses 401 unauthenticated and 403 non-admin', a.status === 401 && b.status === 403,
        JSON.stringify({ anon: a.status, plain: b.status }));
    }

    const created = await call('save-help-article', {
      title: 'Depositing by carrier pigeon', question: 'How do I send a pigeon?',
      topic_id: 'adding-money', lede: 'A lede.', blocks: [{ type: 'p', runs: [{ t: 'Body text.' }] }],
    }, pmToken);
    check('a manager creates an article, and the slug is derived from the title',
      created.status === 200 && created.body.article && created.body.article.slug === 'depositing-by-carrier-pigeon',
      JSON.stringify({ status: created.status, slug: created.body && created.body.article && created.body.article.slug }));
    const artId = created.body.article && created.body.article.id;

    check('a new article starts with draft_dirty true and published_at null',
      created.body.article.draft_dirty === true && created.body.article.published_at === null,
      JSON.stringify({ dirty: created.body.article.draft_dirty, pub: created.body.article.published_at }));

    const dupe = await call('save-help-article', { title: 'Depositing by carrier pigeon', topic_id: 'adding-money' }, pmToken);
    check('a duplicate web address is refused with 409 and a readable reason',
      dupe.status === 409 && /already uses that web address/i.test(dupe.body.error || ''),
      JSON.stringify({ status: dupe.status, error: dupe.body && dupe.body.error }));

    const badSlug = await call('save-help-article', { title: 'x', slug: 'Not A Slug!' }, pmToken);
    check('a malformed web address is refused', badSlug.status === 400, JSON.stringify(badSlug.body));

    const badBlock = await call('save-help-article', {
      id: artId, title: 'Depositing by carrier pigeon', topic_id: 'adding-money',
      blocks: [{ type: 'p', runs: [{ t: 'ok', href: 'javascript:alert(1)' }] }],
    }, pmToken);
    check('★ an unknown key inside a run is REFUSED outright, not stripped — the allowlist is the ' +
      'sanitisation story', badBlock.status === 400 && /unknown key "href"/.test(badBlock.body.error || ''),
      JSON.stringify(badBlock.body));

    const badType = await call('save-help-article', {
      id: artId, title: 'Depositing by carrier pigeon', topic_id: 'adding-money', blocks: [{ type: 'script', text: 'x' }],
    }, pmToken);
    check('an unknown block TYPE is refused', badType.status === 400, JSON.stringify(badType.body));

    const scriptText = await call('save-help-article', {
      id: artId, title: 'Depositing by carrier pigeon', topic_id: 'adding-money', lede: 'A lede.',
      blocks: [{ type: 'p', runs: [{ t: '<script>alert(1)</script>' }] }],
    }, pmToken);
    check('★ a script tag TYPED AS TEXT is stored as literal characters — representable as text, ' +
      'never as markup', scriptText.status === 200 &&
      scriptText.body.article.blocks[0].runs[0].t === '<script>alert(1)</script>', JSON.stringify(scriptText.body && scriptText.body.error));

    // =========================================================================================
    section('3. THE PUBLISH CHECKLIST — enforced server-side, not by a disabled button');
    // =========================================================================================
    const bare = await call('save-help-article', { title: 'Missing most things', topic_id: 'adding-money' }, pmToken);
    const bareId = bare.body.article.id;
    const refused = await call('publish-help-article', { id: bareId }, pmToken);
    check('★ publishing an incomplete article is REFUSED server-side (400), naming what is missing',
      refused.status === 400 && /not ready to publish/i.test(refused.body.error || '') &&
      /question/i.test(refused.body.error) && /opening paragraph/i.test(refused.body.error),
      JSON.stringify(refused.body && refused.body.error));
    const stillDraft = await admin.from('help_articles').select('published_at').eq('id', bareId).single();
    check('...and the refused article is genuinely still unpublished', stillDraft.data.published_at === null,
      JSON.stringify(stillDraft.data));

    // The image case, which is the one an editor skips and a blind reader depends on.
    const withImage = await call('save-help-article', {
      id: bareId, title: 'Missing most things', question: 'q?', topic_id: 'adding-money', lede: 'A lede.',
      blocks: [{ type: 'p', runs: [{ t: 'text' }] }, { type: 'image', path: 'help/x.png', alt: '', caption: 'c' }],
    }, pmToken);
    check('an image block with an EMPTY screen-reader description saves as a draft (drafts are for ' +
      'work in progress)', withImage.status === 200, JSON.stringify(withImage.body && withImage.body.error));
    const altRefused = await call('publish-help-article', { id: bareId }, pmToken);
    check('★ ...but publishing it is refused server-side, naming the screen-reader description',
      altRefused.status === 400 && /screen-reader description/i.test(altRefused.body.error || ''),
      JSON.stringify(altRefused.body && altRefused.body.error));

    await call('save-help-article', {
      id: bareId, title: 'Missing most things', question: 'q?', topic_id: 'adding-money', lede: 'A lede.',
      blocks: [{ type: 'p', runs: [{ t: 'text' }] }, { type: 'image', path: 'help/x.png', alt: 'A real description', caption: 'c' }],
    }, pmToken);
    const altOk = await call('publish-help-article', { id: bareId }, pmToken);
    check('★ ...and once the description is filled in, the same article publishes',
      altOk.status === 200 && altOk.body.article.published_at, JSON.stringify(altOk.body && altOk.body.error));

    // =========================================================================================
    section('4. DRAFT AND PUBLISHED ARE SEPARATE — editing a live article cannot move the site');
    // =========================================================================================
    await call('save-help-article', {
      id: artId, title: 'Depositing by carrier pigeon', question: 'How do I send a pigeon?',
      topic_id: 'adding-money', lede: 'THE PUBLISHED LEDE', blocks: [{ type: 'p', runs: [{ t: 'PUBLISHED BODY' }] }],
    }, pmToken);
    const firstPub = await call('publish-help-article', { id: artId }, pmToken);
    check('the article publishes, draft_dirty clears, first_published_at is stamped',
      firstPub.status === 200 && firstPub.body.article.draft_dirty === false &&
      !!firstPub.body.article.first_published_at, JSON.stringify(firstPub.body && firstPub.body.error));

    await call('save-help-article', {
      id: artId, title: 'Depositing by carrier pigeon', question: 'How do I send a pigeon?',
      topic_id: 'adding-money', lede: 'AN UNPUBLISHED EDIT', blocks: [{ type: 'p', runs: [{ t: 'EDITED BODY' }] }],
    }, pmToken);

    const afterEdit = await anonGet('help_articles_public?slug=eq.depositing-by-carrier-pigeon&select=lede,blocks');
    const ae = Array.isArray(afterEdit.body) && afterEdit.body[0];
    check('★★ THE CORE PROMISE: after editing a LIVE article, the public view still serves the ' +
      'PUBLISHED text — the edit has not reached clients', !!ae && ae.lede === 'THE PUBLISHED LEDE' &&
      JSON.stringify(ae.blocks).indexOf('EDITED BODY') === -1, JSON.stringify(ae));

    const dirty = await admin.from('help_articles').select('draft_dirty').eq('id', artId).single();
    check('...and the article is flagged as having unpublished edits', dirty.data.draft_dirty === true,
      JSON.stringify(dirty.data));

    await call('publish-help-article', { id: artId }, pmToken);
    const afterRepub = await anonGet('help_articles_public?slug=eq.depositing-by-carrier-pigeon&select=lede');
    check('★ pressing Publish again is what moves it — the view now serves the edited text',
      Array.isArray(afterRepub.body) && afterRepub.body[0] && afterRepub.body[0].lede === 'AN UNPUBLISHED EDIT',
      JSON.stringify(afterRepub.body));

    // =========================================================================================
    section('5. UNPUBLISH — off the site immediately, everything kept');
    // =========================================================================================
    const un = await call('unpublish-help-article', { id: artId }, pmToken);
    check('unpublish clears published_at', un.status === 200 && un.body.article.published_at === null,
      JSON.stringify(un.body && un.body.error));
    const gone = await anonGet('help_articles_public?slug=eq.depositing-by-carrier-pigeon&select=slug');
    check('★ ...and it disappears from the public view immediately',
      Array.isArray(gone.body) && gone.body.length === 0, JSON.stringify(gone.body));
    const kept = await admin.from('help_articles').select('pub_title,pub_lede,blocks').eq('id', artId).single();
    check('...while the published copy is KEPT, so re-publishing restores what clients saw',
      kept.data.pub_title === 'Depositing by carrier pigeon' && kept.data.pub_lede === 'AN UNPUBLISHED EDIT',
      JSON.stringify(kept.data && kept.data.pub_title));

    // =========================================================================================
    section('6. THE PLACEMENT CEILINGS the landing depends on');
    // =========================================================================================
    const ids = [];
    for (let i = 0; i < 6; i++) {
      const r = await call('save-help-article', {
        title: 'Ceiling probe ' + SUF + ' ' + i, topic_id: 'investing', in_most_asked: true,
      }, pmToken);
      if (r.status === 200) ids.push(r.body.article.id);
    }
    const seventh = await call('save-help-article', {
      title: 'Ceiling probe ' + SUF + ' seventh', topic_id: 'investing', in_most_asked: true,
    }, pmToken);
    check('★ "Most asked" refuses a 7th article with a readable reason',
      seventh.status === 409 && /Most asked/i.test(seventh.body.error || ''),
      JSON.stringify({ made: ids.length, status: seventh.status, error: seventh.body && seventh.body.error }));

    const f = [];
    for (let i = 0; i < 3; i++) {
      const r = await call('save-help-article', {
        title: 'Feature probe ' + SUF + ' ' + i, topic_id: 'savings', featured_on_topic: true,
      }, pmToken);
      if (r.status === 200) f.push(r.body.article.id);
    }
    const fourth = await call('save-help-article', {
      title: 'Feature probe ' + SUF + ' fourth', topic_id: 'savings', featured_on_topic: true,
    }, pmToken);
    check('★ a topic card refuses a 4th featured article',
      fourth.status === 409 && /features 3 articles/i.test(fourth.body.error || ''),
      JSON.stringify({ made: f.length, status: fourth.status, error: fourth.body && fourth.body.error }));

  } finally {
    // Every row this run created, by its own unique suffix plus the two fixed slugs it used.
    await admin.from('help_articles').delete().in('slug', [DRAFT_SLUG, LIVE_SLUG,
      'depositing-by-carrier-pigeon', 'missing-most-things']);
    await admin.from('help_articles').delete().like('slug', 'ceiling-probe-' + SUF + '%');
    await admin.from('help_articles').delete().like('slug', 'feature-probe-' + SUF + '%');
    const { data: u } = await admin.auth.admin.listUsers({ perPage: 200 });
    const probe = (u && u.users || []).find((x) => x.email === plainEmail);
    if (probe) await admin.auth.admin.deleteUser(probe.id);
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  console.log(failed === 0 ? 'HELP CENTER BACKEND: PASS' : 'HELP CENTER BACKEND: FAIL');
  if (failed > 0) process.exit(1);
}

runVerifyMain(main, { watchdogMs: 6 * 60 * 1000 });
