#!/usr/bin/env node
// Blog & Press — backend verification (2026-09-24, register row 274).
//
// What this proves, in the order the brief asked for it:
//   1. a DRAFT post is unreachable by an anonymous visitor, through the table AND through the view
//   2. blog_comments_public exposes NO client id and NO email — asserted as a column list
//   3. a pending-review client, a rejected client and an anonymous visitor are each refused when
//      they try to comment, reply or like
//   4. a second like from the same client is refused
//   5. one client cannot remove another's comment
//   6. a <script> is STORED as literal text (the render half is the visual suite's job)
//   7. removing a comment WITH replies leaves the placeholder and the replies; removing one
//      WITHOUT replies removes it entirely
//   8. a comment mentioning "38%" is flagged AND still published
//   9. the Help Center's checklist still requires "The question it answers"
//
// Everything created here is deleted at the end.
const { createClient } = require('@supabase/supabase-js');
const { execSync } = require('node:child_process');
const { runVerifyMain } = require('./lib/run-verify.mjs');

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
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
const PW = 'BlogProbe-2026!';

async function main() {
  const st = stack();
  const url = st.API_URL, anonKey = st.ANON_KEY;
  const admin = createClient(url, st.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  const call = async (fn, body, token) => {
    const res = await fetch(url + '/functions/v1/' + fn, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
      body: JSON.stringify(body || {}),
    });
    let parsed = null; try { parsed = await res.json(); } catch { /* no body */ }
    return { status: res.status, body: parsed };
  };

  const made = { users: [], posts: [] };

  async function makeClient(tag, status) {
    const email = 'blog-' + tag + '-' + SUF + '@test.marketswave.local';
    const { data: u, error } = await admin.auth.admin.createUser({ email, password: PW, email_confirm: true });
    if (error) throw new Error('createUser ' + tag + ': ' + error.message);
    made.users.push(u.user.id);
    const { error: cErr } = await admin.from('clients').insert({
      id: u.user.id, name: 'Blog ' + tag.toUpperCase() + ' ' + SUF, email,
      phone: '+46000000000', account_type: 'Individual Account', status,
    });
    if (cErr) throw new Error('clients insert ' + tag + ': ' + cErr.message);
    const c = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: s, error: sErr } = await c.auth.signInWithPassword({ email, password: PW });
    if (sErr) throw new Error('signIn ' + tag + ': ' + sErr.message);
    return { id: u.user.id, email, name: 'Blog ' + tag.toUpperCase() + ' ' + SUF, token: s.session.access_token, client: c };
  }

  try {
    // ---- sessions ---------------------------------------------------------------------------
    const pmClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: pmSession, error: pmErr } = await pmClient.auth.signInWithPassword({
      email: 'pm@marketswave.local', password: 'MarketswavePM-Local-2026!',
    });
    if (pmErr) throw new Error('could not sign in the local bootstrap PM: ' + pmErr.message);
    const pmToken = pmSession.session.access_token;

    const active = await makeClient('active', 'active');
    const other = await makeClient('other', 'active');
    const pending = await makeClient('pending', 'pending_review');
    const rejected = await makeClient('rejected', 'rejected');
    const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

    // =========================================================================================
    section('1. The published-only boundary — a draft is unreachable by the public');
    // =========================================================================================
    const draft = await call('save-blog-post', {
      title: 'Draft probe ' + SUF, slug: 'draft-probe-' + SUF, category: 'explainer',
      lede: 'A draft that must never be readable by an anonymous visitor.',
      blocks: [{ type: 'p', runs: [{ t: 'Draft body.' }] }],
    }, pmToken);
    check('a draft post is created', draft.status === 200 && draft.body.id, JSON.stringify(draft.body));
    made.posts.push(draft.body.id);

    const anonTable = await anon.from('blog_posts').select('id').eq('id', draft.body.id);
    check('★ anon reading blog_posts directly is refused (42501), not merely empty',
      !!anonTable.error && anonTable.error.code === '42501',
      anonTable.error ? anonTable.error.code : JSON.stringify(anonTable.data));

    const anonView = await anon.from('blog_posts_public').select('id').eq('id', draft.body.id);
    check('★ the public VIEW does not carry the draft — a different mechanism, also closed',
      !anonView.error && Array.isArray(anonView.data) && anonView.data.length === 0,
      anonView.error ? anonView.error.message : JSON.stringify(anonView.data));

    // Non-vacuity: the view genuinely works for something that IS published.
    const live = await call('save-blog-post', {
      title: 'Live probe ' + SUF, slug: 'live-probe-' + SUF, category: 'article',
      lede: 'A published post, so the view is proven to return something.',
      blocks: [{ type: 'p', runs: [{ t: 'Live body.' }] }],
      cover_path: 'blog/probe/cover.png', cover_alt: 'A probe cover image',
    }, pmToken);
    made.posts.push(live.body.id);
    const pub = await call('publish-blog-post', { id: live.body.id }, pmToken);
    check('a complete post publishes', pub.status === 200 && pub.body.publishedAt, JSON.stringify(pub.body));
    const anonLive = await anon.from('blog_posts_public').select('id, title').eq('id', live.body.id);
    check('...and the published post IS readable by anon through the view (non-vacuity)',
      !anonLive.error && anonLive.data.length === 1, JSON.stringify(anonLive.error || anonLive.data));

    // The checklist refuses an incomplete post — the cover is the blog's own required item.
    const incomplete = await call('publish-blog-post', { id: draft.body.id }, pmToken);
    check('★ publishing without a cover image is refused, naming it',
      incomplete.status === 400 && /cover image/i.test(incomplete.body.error || ''), JSON.stringify(incomplete.body));

    // =========================================================================================
    section('2. blog_comments_public is a privacy boundary');
    // =========================================================================================
    // The authoritative list comes from the catalog, not from a sample row: an empty result set
    // carries no columns, and a populated one only proves what that row happened to have.
    const catalog = execSync(
      'docker exec supabase_db_Marketswave psql -U postgres -d postgres -At -c ' +
      '"select string_agg(column_name, \',\' order by ordinal_position) from information_schema.columns where table_name=\'blog_comments_public\';"',
      { encoding: 'utf8' }).trim();
    const colList = catalog.split(',');
    check('★ the public comments view exposes exactly the agreed columns',
      catalog === 'id,post_id,parent_id,display_name,body,created_at,is_marketswave,removed', catalog);
    check('★ it carries NO client id and NO email',
      colList.indexOf('client_id') === -1 && !colList.some((c) => /email/.test(c)), catalog);
    check('...and nothing about who removed a comment either',
      !colList.some((c) => /removed_by/.test(c)), catalog);

    // =========================================================================================
    section('3. Only an ACTIVE signed-in client may write');
    // =========================================================================================
    const postId = live.body.id;
    for (const [who, token, expect] of [
      ['an anonymous visitor', null, 401],
      ['a pending-review client', pending.token, 403],
      ['a rejected client', rejected.token, 403],
    ]) {
      const c = await call('post-blog-comment', { postId, body: 'Trying to comment.' }, token);
      check(who + ' cannot COMMENT (' + expect + ')', c.status === expect, c.status + ' ' + JSON.stringify(c.body));
      const l = await call('toggle-blog-like', { postId, liked: true }, token);
      check(who + ' cannot LIKE (' + expect + ')', l.status === expect, l.status + ' ' + JSON.stringify(l.body));
    }
    check('the pending client is told WHY, in its own words',
      /under review/i.test((await call('post-blog-comment', { postId, body: 'x' }, pending.token)).body.error || ''));

    const ok1 = await call('post-blog-comment', { postId, body: 'A genuine first comment from an active client.' }, active.token);
    check('★ an ACTIVE client CAN comment (non-vacuity)', ok1.status === 200 && ok1.body.id, JSON.stringify(ok1.body));
    check('...and it carries the name from the ACCOUNT, not from the request',
      ok1.body.display_name === active.name, ok1.body.display_name);

    // A caller cannot choose their display name.
    const spoof = await call('post-blog-comment',
      { postId, body: 'Trying to post under another name.', display_name: 'Someone Else' }, active.token);
    check('a display_name sent by the caller is ignored',
      spoof.status === 200 && spoof.body.display_name === active.name, spoof.body.display_name);

    // =========================================================================================
    section('4. One like per client per post');
    // =========================================================================================
    const like1 = await call('toggle-blog-like', { postId, liked: true }, active.token);
    check('the first like is recorded', like1.status === 200 && like1.body.likes === 1, JSON.stringify(like1.body));
    const like2 = await call('toggle-blog-like', { postId, liked: true }, active.token);
    check('★ a second like from the same client is refused (409)', like2.status === 409, JSON.stringify(like2.body));
    const direct = await admin.from('blog_likes').insert({ post_id: postId, client_id: active.id });
    check('★ ...and even service_role cannot insert a duplicate — the primary key is the rule',
      !!direct.error && direct.error.code === '23505', direct.error ? direct.error.code : 'no error');
    const unlike = await call('toggle-blog-like', { postId, liked: false }, active.token);
    check('a like can be taken back', unlike.status === 200 && unlike.body.likes === 0, JSON.stringify(unlike.body));
    await call('toggle-blog-like', { postId, liked: true }, active.token);

    // =========================================================================================
    section('5. Replies are one level deep, and reach the right person');
    // =========================================================================================
    const parentId = ok1.body.id;
    const reply = await call('post-blog-comment', { postId, parentId, body: 'A reply from another client.' }, other.token);
    check('another active client can reply', reply.status === 200 && reply.body.parent_id === parentId, JSON.stringify(reply.body));
    const deep = await call('post-blog-comment', { postId, parentId: reply.body.id, body: 'A reply to a reply.' }, active.token);
    check('★ a reply to a reply is refused — conversations stay one level deep',
      deep.status === 400 && /original comment/i.test(deep.body.error || ''), JSON.stringify(deep.body));
    const deepDirect = await admin.from('blog_comments').insert({
      post_id: postId, parent_id: reply.body.id, client_id: active.id, display_name: active.name, body: 'direct',
    });
    check('★ ...and even service_role cannot nest one — the trigger is the rule',
      !!deepDirect.error && /original comment/i.test(deepDirect.error.message || ''),
      deepDirect.error ? deepDirect.error.message : 'no error');

    // The bell's own source: the replied-to client can read their OWN comment, and the reply to
    // it is visible through the public view. That pair IS the notification.
    const ownRead = await active.client.from('blog_comments').select('id').eq('id', parentId);
    check('★ the replied-to client can read their OWN comment (what the bell keys off)',
      !ownRead.error && ownRead.data.length === 1, JSON.stringify(ownRead.error || ownRead.data));
    const othersRead = await active.client.from('blog_comments').select('id').eq('id', reply.body.id);
    check('...but NOT another client\'s comment row', !othersRead.error && othersRead.data.length === 0,
      JSON.stringify(othersRead.error || othersRead.data));
    const replyVisible = await anon.from('blog_comments_public').select('id, parent_id').eq('parent_id', parentId);
    check('...and the reply is visible publicly, attached to that comment',
      !replyVisible.error && replyVisible.data.some((r) => r.id === reply.body.id), JSON.stringify(replyVisible.data));

    // =========================================================================================
    section('6. A client removes their OWN comment, and only their own');
    // =========================================================================================
    // The gate is ownership, not account status: writing adds words to a public page and needs
    // an ACTIVE client, but removing takes the author's own words back off it. These assertions
    // are what stop that distinction being quietly re-tightened into "active only" later.
    // ★ THIS SECTION GETS ITS OWN TWO CLIENTS, and that is not tidiness. Every comment costs the
    // author one of five per ten minutes, so borrowing `active`/`other` here spends budget that
    // later sections need — the first draft did exactly that and pushed section 10's flag test
    // into a 429, which reads as "flagging is broken" rather than "the fixture ran out". A
    // section that creates what it consumes cannot be broken by, or break, its neighbours.
    const author = await makeClient('author', 'active');
    const bystander = await makeClient('bystander', 'active');

    const clientRemove = await call('remove-own-blog-comment', { commentId: ok1.body.id }, bystander.token);
    check("★ one client cannot remove ANOTHER's comment (403)", clientRemove.status === 403, JSON.stringify(clientRemove.body));
    check('...and is told exactly why, in words that name the rule',
      /only remove your own/i.test(clientRemove.body.error || ''), clientRemove.body.error);
    const { data: untouched } = await admin.from('blog_comments').select('removed_at').eq('id', ok1.body.id).single();
    check('★ ...and the refused attempt left the row genuinely untouched',
      untouched.removed_at === null, JSON.stringify(untouched));

    const selfNoAuth = await call('remove-own-blog-comment', { commentId: ok1.body.id }, null);
    check('an unauthenticated caller is refused (401)', selfNoAuth.status === 401, selfNoAuth.status);

    const mine1 = await call('post-blog-comment', { postId, body: 'Something I will think better of.' }, author.token);
    check('(fixture) the author posts a comment of their own', mine1.status === 200 && !!mine1.body.id, JSON.stringify(mine1.body));
    const mineReply = await call('post-blog-comment', { postId, parentId: mine1.body.id, body: 'A reply to it from someone else.' }, bystander.token);
    check('(fixture) another client replies to it', mineReply.status === 200, JSON.stringify(mineReply.body));

    const selfRm1 = await call('remove-own-blog-comment', { commentId: mine1.body.id }, author.token);
    check('★ the AUTHOR removes their own comment (200)', selfRm1.status === 200 && selfRm1.body.removed === true, JSON.stringify(selfRm1.body));
    check('★ ...it HAS replies, so it is kept as a placeholder', selfRm1.body.keptAsPlaceholder === true, JSON.stringify(selfRm1.body));
    const selfView = await anon.from('blog_comments_public').select('id, display_name, body, removed').eq('id', mine1.body.id);
    check('★ ...and a reader sees removed true, NO name, NO body — same as a PM removal',
      selfView.data.length === 1 && selfView.data[0].removed === true &&
      selfView.data[0].display_name === null && selfView.data[0].body === null, JSON.stringify(selfView.data));
    const selfRepliesKept = await anon.from('blog_comments_public').select('id').eq('parent_id', mine1.body.id);
    check('★ ...and the reply underneath it is kept',
      selfRepliesKept.data.some((r) => r.id === mineReply.body.id), JSON.stringify(selfRepliesKept.data));
    const { data: selfRow } = await admin
      .from('blog_comments').select('removed_by, removed_by_email').eq('id', mine1.body.id).single();
    check('★ ...and the record says the AUTHOR removed it, not a PM — what lets the PM tool tell a retraction from a moderation',
      selfRow.removed_by === author.id, JSON.stringify(selfRow));

    const selfAgain = await call('remove-own-blog-comment', { commentId: mine1.body.id }, author.token);
    check('removing it twice is refused (409)', selfAgain.status === 409, selfAgain.status + ' ' + JSON.stringify(selfAgain.body));

    const mine2 = await call('post-blog-comment', { postId, body: 'A lone comment of my own, no replies.' }, author.token);
    const selfRm2 = await call('remove-own-blog-comment', { commentId: mine2.body.id }, author.token);
    check('the author removes one with NO replies', selfRm2.status === 200 && selfRm2.body.keptAsPlaceholder === false, JSON.stringify(selfRm2.body));
    const selfGone = await anon.from('blog_comments_public').select('id').eq('id', mine2.body.id);
    check('★ ...and it disappears from the public view entirely', selfGone.data.length === 0, JSON.stringify(selfGone.data));

    // A reply is the author's to retract too — removal is per comment, not per thread.
    const myReply = await call('post-blog-comment', { postId, parentId, body: 'A reply of my own.' }, bystander.token);
    const rmMyReply = await call('remove-own-blog-comment', { commentId: myReply.body.id }, bystander.token);
    check('★ a client can remove their own REPLY as well as a top-level comment', rmMyReply.status === 200, JSON.stringify(rmMyReply.body));

    const ownRemove = await call('moderate-blog-comment', { action: 'remove', commentId: ok1.body.id }, active.token);
    check('...while moderate-blog-comment stays PM-only — a client cannot reach the moderator route (403)',
      ownRemove.status === 403, ownRemove.status + ' ' + JSON.stringify(ownRemove.body));
    const upd = await active.client.from('blog_comments').update({ body: 'edited' }).eq('id', parentId).select();
    check('★ a client cannot EDIT a comment directly either — no UPDATE policy exists',
      !upd.error ? (upd.data || []).length === 0 : true, JSON.stringify(upd.error || upd.data));
    const del = await other.client.from('blog_comments').delete().eq('id', parentId).select();
    check('...and cannot DELETE one', !del.error ? (del.data || []).length === 0 : true, JSON.stringify(del.error || del.data));

    // =========================================================================================
    section('7. A script tag is stored as literal text');
    // =========================================================================================
    const XSS = '<script>alert("x")</script> and <img src=x onerror=alert(1)>';
    const xss = await call('post-blog-comment', { postId, body: XSS }, other.token);
    check('a comment containing a script tag is accepted', xss.status === 200, JSON.stringify(xss.body));
    const { data: stored } = await admin.from('blog_comments').select('body').eq('id', xss.body.id).single();
    check('★ it is STORED byte-for-byte as text, not stripped and not executed',
      stored.body === XSS, stored.body);
    const viaView = await anon.from('blog_comments_public').select('body').eq('id', xss.body.id).single();
    check('...and comes back through the public view unchanged',
      viaView.data.body === XSS, viaView.data.body);

    // =========================================================================================
    section('8. Removal: with replies it becomes a placeholder; without, it goes');
    // =========================================================================================
    const rm1 = await call('moderate-blog-comment', { action: 'remove', commentId: parentId }, pmToken);
    check('the PM removes a comment that HAS replies', rm1.status === 200 && rm1.body.keptAsPlaceholder === true, JSON.stringify(rm1.body));
    const afterView = await anon.from('blog_comments_public').select('id, display_name, body, removed').eq('id', parentId);
    check('★ it stays as a placeholder — removed true, NO name, NO body',
      afterView.data.length === 1 && afterView.data[0].removed === true &&
      afterView.data[0].display_name === null && afterView.data[0].body === null,
      JSON.stringify(afterView.data));
    const repliesKept = await anon.from('blog_comments_public').select('id').eq('parent_id', parentId);
    check('★ ...and its replies are kept', repliesKept.data.some((r) => r.id === reply.body.id), JSON.stringify(repliesKept.data));

    const lone = await call('post-blog-comment', { postId, body: 'A comment with no replies at all.' }, other.token);
    const rm2 = await call('moderate-blog-comment', { action: 'remove', commentId: lone.body.id }, pmToken);
    check('the PM removes a comment with NO replies', rm2.status === 200 && rm2.body.keptAsPlaceholder === false, JSON.stringify(rm2.body));
    const goneView = await anon.from('blog_comments_public').select('id').eq('id', lone.body.id);
    check('★ ...and it disappears from the public view entirely', goneView.data.length === 0, JSON.stringify(goneView.data));
    const { data: stillThere } = await admin.from('blog_comments').select('id, removed_at').eq('id', lone.body.id).maybeSingle();
    check('...while the row itself is kept, so the PM\'s Removed filter can still show it',
      !!stillThere && !!stillThere.removed_at, JSON.stringify(stillThere));

    // =========================================================================================
    section('9. A Marketswave reply');
    // =========================================================================================
    const mw = await call('moderate-blog-comment', { action: 'reply', commentId: reply.body.id, body: 'Thanks — the New Pocket screen shows each term.' }, pmToken);
    check('the PM replies as Marketswave', mw.status === 200 && mw.body.is_marketswave === true, JSON.stringify(mw.body));
    check('★ it attaches to the ORIGINAL comment, not to the reply it answers',
      mw.body.parent_id === parentId, mw.body.parent_id + ' vs ' + parentId);
    const mwView = await anon.from('blog_comments_public').select('display_name, is_marketswave').eq('id', mw.body.id).single();
    check('...and carries no client name — it is from the firm',
      mwView.data.is_marketswave === true && mwView.data.display_name === null, JSON.stringify(mwView.data));

    // =========================================================================================
    section('10. The flag is a prompt, never a decision');
    // =========================================================================================
    const flagged = await call('post-blog-comment',
      { postId, body: 'Made 38% on the Nordic fund this year, best decision I have made.' }, other.token);
    check('★ a comment mentioning "38%" is accepted and PUBLISHED', flagged.status === 200, JSON.stringify(flagged.body));
    check('★ ...and is flagged', flagged.body.flagged === true, JSON.stringify(flagged.body));
    const flagPublic = await anon.from('blog_comments_public').select('id, body').eq('id', flagged.body.id);
    check('★ ...and is visible to the public, exactly like any other — nothing is hidden',
      flagPublic.data.length === 1 && /38%/.test(flagPublic.data[0].body), JSON.stringify(flagPublic.data));
    const { data: flagRow } = await admin.from('blog_comments').select('flag_reason').eq('id', flagged.body.id).single();
    check('...and the PM is told why, in words', /percentage/i.test(flagRow.flag_reason || ''), flagRow.flag_reason);

    const plain = await call('post-blog-comment', { postId, body: 'Clear and short. More of these, please.' }, other.token);
    check('a comment with no money in it is NOT flagged (non-vacuity)', plain.body.flagged === false, JSON.stringify(plain.body));

    const currency = await call('post-blog-comment', { postId, body: 'I put $4,000 in last month.' }, active.token);
    check('a currency figure is flagged too', currency.body.flagged === true, JSON.stringify(currency.body));

    // =========================================================================================
    section('11. The rate limit');
    // =========================================================================================
    // `other` has already posted several; push past the window allowance and confirm the refusal.
    let limited = null;
    for (let i = 0; i < 8; i++) {
      const r = await call('post-blog-comment', { postId, body: 'Rate probe number ' + i + '.' }, other.token);
      if (r.status === 429) { limited = r; break; }
    }
    check('★ a client is rate-limited after the allowance, with a message saying when to retry',
      !!limited && /minutes/i.test(limited.body.error || ''), limited ? JSON.stringify(limited.body) : 'never limited');

    // A body over the cap is refused, by the function AND by the table.
    const long = await call('post-blog-comment', { postId, body: 'x'.repeat(1501) }, active.token);
    check('a comment over 1500 characters is refused', long.status === 400 && /1500/.test(long.body.error || ''), JSON.stringify(long.body));
    const longDirect = await admin.from('blog_comments').insert({
      post_id: postId, client_id: active.id, display_name: active.name, body: 'y'.repeat(1501),
    });
    check('★ ...and even service_role cannot exceed it — the CHECK is the rule',
      !!longDirect.error, longDirect.error ? longDirect.error.code : 'no error');

    // =========================================================================================
    section('12. One featured post at a time');
    // =========================================================================================
    await call('save-blog-post', { id: live.body.id, title: 'Live probe ' + SUF, slug: 'live-probe-' + SUF,
      category: 'article', lede: 'x', blocks: [{ type: 'p', runs: [{ t: 'y' }] }],
      cover_path: 'blog/probe/cover.png', cover_alt: 'cover', featured: true }, pmToken);
    const feat1 = await call('publish-blog-post', { id: live.body.id }, pmToken);
    check('a post can be featured', feat1.status === 200 && feat1.body.featured === true, JSON.stringify(feat1.body));

    const second = await call('save-blog-post', { title: 'Second feature ' + SUF, slug: 'second-feature-' + SUF,
      category: 'company-news', lede: 'x', blocks: [{ type: 'p', runs: [{ t: 'y' }] }],
      cover_path: 'blog/probe/cover2.png', cover_alt: 'cover', featured: true }, pmToken);
    made.posts.push(second.body.id);
    const feat2 = await call('publish-blog-post', { id: second.body.id }, pmToken);
    check('featuring a second post succeeds', feat2.status === 200 && feat2.body.featured === true, JSON.stringify(feat2.body));
    const { data: featured } = await admin.from('blog_posts').select('id').eq('pub_featured', true);
    check('★ ...and there is exactly ONE featured post afterwards — the first was replaced',
      featured.length === 1 && featured[0].id === second.body.id, JSON.stringify(featured));

    // =========================================================================================
    section('13. The Help Center is unchanged by the shared checklist gaining a kind');
    // =========================================================================================
    const hcNoQuestion = await call('save-help-article', {
      slug: 'blog-probe-hc-' + SUF, topic_id: 'investing', title: 'Probe ' + SUF,
      lede: 'An article deliberately missing its question.',
      blocks: [{ type: 'p', runs: [{ t: 'Body.' }] }],
    }, pmToken);
    const hcId = hcNoQuestion.body.article && hcNoQuestion.body.article.id;
    check('the probe article was created (non-vacuity for the two checks below)', !!hcId, JSON.stringify(hcNoQuestion.body).slice(0, 200));
    const hcPub = await call('publish-help-article', { id: hcId }, pmToken);
    check('★ a Help Center article STILL cannot publish without "the question it answers"',
      hcPub.status === 400 && /question it answers/i.test(hcPub.body.error || ''), JSON.stringify(hcPub.body));
    check('...and it is still called an article, not a post', /This article is not ready/.test(hcPub.body.error || ''), hcPub.body.error);
    await admin.from('help_articles').delete().eq('id', hcId);

    check('★ ...and its checklist still comes back FROM THE SERVER, with that item in it',
      Array.isArray(hcNoQuestion.body.checklist) &&
      hcNoQuestion.body.checklist.some((c) => /question it answers/i.test(c.label) && c.ok === false),
      JSON.stringify(hcNoQuestion.body.checklist));

    const blogSave = await call('save-blog-post', { title: 'Checklist probe ' + SUF, slug: 'checklist-probe-' + SUF,
      category: 'explainer', lede: 'x', blocks: [{ type: 'p', runs: [{ t: 'y' }] }] }, pmToken);
    made.posts.push(blogSave.body.id);
    check("★ a POST's checklist also comes back from the server, so the editor cannot drift from it",
      Array.isArray(blogSave.body.checklist) && blogSave.body.checklist.length > 0,
      JSON.stringify(blogSave.body.checklist));
    check('...and it carries NO "question it answers" item — optional for a post',
      !blogSave.body.checklist.some((c) => /question it answers/i.test(c.label)),
      JSON.stringify(blogSave.body.checklist.map((c) => c.label)));
    check('...while it DOES require a cover image',
      blogSave.body.checklist.some((c) => /cover image/i.test(c.label) && c.ok === false),
      JSON.stringify(blogSave.body.checklist.map((c) => c.label)));

    // The blog's own list genuinely differs: no question required.
    const postNoQuestion = await admin.from('blog_posts').select('question').eq('id', second.body.id).single();
    check('★ ...while a POST published with no question at all is live',
      postNoQuestion.data.question === null, JSON.stringify(postNoQuestion.data));

  } finally {
    // ---- cleanup: users first (cascades), then posts --------------------------------------
    for (const id of made.users) {
      await admin.from('clients').delete().eq('id', id);
      await admin.auth.admin.deleteUser(id).catch(() => {});
    }
    for (const id of made.posts) await admin.from('blog_posts').delete().eq('id', id);
    const { data: leftPosts } = await admin.from('blog_posts').select('id').like('slug', '%-' + SUF);
    const { count: leftUsers } = await admin
      .from('clients').select('id', { count: 'exact', head: true }).like('email', '%' + SUF + '%');
    console.log('\ncleanup: posts remaining ' + ((leftPosts || []).length) + ', clients remaining ' + (leftUsers || 0));
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed.');
  console.log(fail === 0 ? 'BLOG PRESS: PASS' : 'BLOG PRESS: FAIL');
  if (fail > 0) process.exitCode = 1;
}

runVerifyMain(main, { watchdogMs: 10 * 60 * 1000 });
