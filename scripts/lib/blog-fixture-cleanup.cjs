// blog-fixture-cleanup.cjs — the ONE teardown for the three blog suites (2026-10-01).
//
// What was wrong: each suite deleted its client rows and called auth.admin.deleteUser() wrapped in
// .catch(() => {}). supabase-js does not THROW on failure, it RESOLVES with { error } — so a
// refused delete was discarded, and the suites' own end-of-run check counted `clients` rows, not
// auth accounts, so it printed "clients remaining 0" while every account survived. One full pass
// left 8 accounts and 2 cover images behind.
//
// Why accounts were refused: blog_comments.removed_by references auth.users with NO cascade, so a
// test client who withdrew their own comment cannot be deleted while that comment exists. Deleting
// the POST first cascades its comments and likes (blog_comments/blog_likes.post_id are ON DELETE
// CASCADE), which clears the blocker. Row 178's principle in its corrected form: delete whatever
// clears the NEXT blocker first — not "accounts first". Here that is the post.
//
// Order: posts → client rows → accounts (error read) → uploaded cover objects → re-read.
// Every failure is a "TEARDOWN WARNING" line (the harness contract, row 201), and the re-read
// counts what actually remains — accounts by the run's own email fragment, covers by path — so a
// leak is reported by name instead of hidden behind a count of the wrong table.
'use strict';

async function listAllUsers(admin) {
  const out = [];
  for (let page = 1; page < 200; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error('listUsers: ' + error.message);
    out.push(...data.users);
    if (data.users.length < 1000) break;
  }
  return out;
}

/**
 * @param admin a service_role supabase-js client
 * @param made  { posts: [], users: [], covers?: [] }
 * @param emailFragment a string every account this run created carries in its email (e.g. '-' + SUF + '@')
 * @returns { posts, accounts, covers, warnings } — what REMAINS after cleanup, re-read
 */
async function cleanupBlogFixtures(admin, made, emailFragment) {
  const warnings = [];
  const warn = (m) => { warnings.push(m); console.log('  TEARDOWN WARNING  ' + m); };

  for (const id of made.posts || []) {
    const { error } = await admin.from('blog_posts').delete().eq('id', id);
    if (error) warn('blog post ' + id + ': ' + error.message);
  }
  for (const id of made.users || []) {
    const c = await admin.from('clients').delete().eq('id', id);
    if (c.error) warn('client row ' + id + ': ' + c.error.message);
    const u = await admin.auth.admin.deleteUser(id);
    if (u.error) warn('account ' + id + ': ' + u.error.message);
  }
  const covers = (made.covers || []).filter(Boolean);
  if (covers.length) {
    const { error } = await admin.storage.from('article-images').remove(covers);
    if (error) warn('cover images ' + covers.join(', ') + ': ' + error.message);
  }

  // ---- re-read what actually remains ----
  const postsLeft = [];
  for (const id of made.posts || []) {
    const { data } = await admin.from('blog_posts').select('id').eq('id', id).maybeSingle();
    if (data) postsLeft.push(id);
  }
  const accountsLeft = (await listAllUsers(admin)).filter((u) => (u.email || '').includes(emailFragment)).map((u) => u.email);
  const coversLeft = [];
  for (const p of covers) {
    const dir = p.split('/').slice(0, -1).join('/');
    const name = p.split('/').pop();
    const { data } = await admin.storage.from('article-images').list(dir, { limit: 100 });
    if ((data || []).some((o) => o.name === name)) coversLeft.push(p);
  }
  for (const e of accountsLeft) warn('account still exists after cleanup: ' + e);
  for (const p of coversLeft) warn('cover image still exists after cleanup: ' + p);
  console.log('\ncleanup: posts remaining ' + postsLeft.length + ', test accounts remaining ' + accountsLeft.length + ', cover images remaining ' + coversLeft.length);
  return { posts: postsLeft.length, accounts: accountsLeft.length, covers: coversLeft.length, warnings };
}

module.exports = { cleanupBlogFixtures };
