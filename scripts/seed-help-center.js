// seed-help-center.js — the one approved Help Center article, published (2026-09-23).
//
// "Depositing crypto", exactly as written in the approved help_article.html mockup. The other 31
// articles are written afterwards through the editor, which is the whole point of storing them
// in the database: this script exists to put the FIRST one there, not to become the way articles
// are added.
//
// Idempotent: upserts on the slug and republishes, so re-running it restores the approved text
// if someone has edited it in the editor. It writes the draft side and the published side in one
// go, which is what makes the article live — publishing is normally publish-help-article's job,
// and this is the one place that shortcut is correct, because there is no manager in the loop.
//
// Usage (from scripts/):
//   node seed-help-center.js              # local stack
//   node seed-help-center.js --staging    # real cloud staging (service_role key file)
const { createClient } = require('@supabase/supabase-js');
const { execSync } = require('child_process');
const { readFileSync } = require('fs');

const staging = process.argv.includes('--staging');

function conn() {
  if (staging) {
    const f = process.env.SUPABASE_STAGING_CREDENTIALS_FILE || 'C:/WorkDirectory/marketswave-secrets/supabase-staging-api-keys.json';
    const key = JSON.parse(readFileSync(f, 'utf8')).find((e) => e.name === 'service_role').api_key;
    return { url: 'https://ujnmlwbpginplfnofhhv.supabase.co', key, label: 'REAL CLOUD STAGING' };
  }
  const raw = execSync('supabase status -o json', { cwd: '..', encoding: 'utf8' });
  const st = JSON.parse(raw.slice(raw.indexOf('{')));
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(st.API_URL)) throw new Error('refusing a non-local API_URL: ' + st.API_URL);
  return { url: st.API_URL, key: st.SERVICE_ROLE_KEY, label: 'LOCAL STACK' };
}

const t = (s) => ({ t: s });
const b = (s) => ({ t: s, b: true });

const BLOCKS = [
  { type: 'heading', text: 'Before you send anything' },
  {
    type: 'p', runs: [
      t('Check the '), b('network'), t(', not just the coin. Tether exists on both Ethereum and Tron, and the two use completely different addresses. Sending TRC-20 Tether to an Ethereum address destroys it \u2014 nobody can recover it, including us.'),
    ],
  },
  {
    type: 'p', runs: [
      t('Your address is shown on the deposit screen with its network beneath it. If the address you\u2019re pasting into your wallet doesn\u2019t match that network, stop.'),
    ],
  },
  { type: 'heading', text: 'Sending a deposit' },
  {
    type: 'steps', steps: [
      {
        title: 'Open Deposit and choose your currency',
        body: [t('If you don\u2019t see an address for the coin you want, it hasn\u2019t been assigned to your account yet. Message your portfolio manager and they\u2019ll set one up.')],
      },
      {
        title: 'Copy the address \u2014 don\u2019t type it',
        body: [t('Use the copy button. A single wrong character sends your money somewhere unrecoverable.')],
      },
      {
        title: 'Send from your wallet or exchange',
        body: [t('Your wallet will show a transaction hash once it\u2019s sent \u2014 a long string starting '), b('0x'), t(' on Ethereum, or a similar string on Bitcoin and Tron. Copy it.')],
      },
      {
        title: 'Tell us it\u2019s on the way',
        body: [t('Back on the deposit screen, paste the hash and submit. This is the step that links your payment to your account \u2014 without it, your manager sees a payment arrive with no way to know it\u2019s yours.')],
      },
    ],
  },
  {
    type: 'warning',
    title: 'Don\u2019t send your fee payment to this address',
    body: [t('If you\u2019re paying an invoice, that\u2019s a different address, shown on the invoice itself. Money sent to your deposit address is added to your investable capital \u2014 it won\u2019t settle the invoice, and moving it across means asking your manager to do it by hand.')],
  },
  { type: 'heading', text: 'What happens next' },
  {
    type: 'p', runs: [
      t('Your portfolio manager checks the blockchain, confirms the amount that actually arrived, and credits it. The credited figure is what landed after network fees, so it may be slightly less than you sent.'),
    ],
  },
  {
    type: 'p', runs: [
      t('You\u2019ll see it in '), b('Pending requests'), t(' on your dashboard until it\u2019s credited, then as a deposit in your activity, and your unallocated capital goes up by that amount. You\u2019ll get an email when it\u2019s done.'),
    ],
  },
  {
    type: 'tip',
    body: [t('A credited deposit isn\u2019t invested yet. It sits as '), b('unallocated capital'), t(' earning nothing until you request an allocation \u2014 that\u2019s a separate step, and it\u2019s yours to make.')],
  },
];

const ARTICLE = {
  slug: 'depositing-crypto',
  topic_id: 'adding-money',
  title: 'Depositing crypto',
  question: 'How do I send crypto, and why do you need the transaction hash?',
  lede: 'Your deposit address is shared with other clients, so we can\u2019t tell your payment apart from anyone else\u2019s by looking at the blockchain. That\u2019s why we ask for the transaction hash \u2014 it\u2019s how your money gets matched to your account.',
  blocks: BLOCKS,
  // Deliberately empty: the three articles the mockup relates to are not written yet, and a
  // related link to an article that does not exist renders as nothing. Set them in the editor
  // once those articles exist, rather than seeding links that point nowhere.
  related_slugs: [],
  in_most_asked: true,
  featured_on_topic: true,
  product_slot: 'crypto-deposit',
};

function readingMinutes(lede, blocks) {
  const parts = [lede];
  for (const bl of blocks) {
    if (bl.type === 'heading') parts.push(bl.text);
    else if (bl.type === 'p') parts.push(bl.runs.map((r) => r.t).join(''));
    else if (bl.type === 'tip' || bl.type === 'warning') {
      if (bl.title) parts.push(bl.title);
      parts.push((bl.body || []).map((r) => r.t).join(''));
    } else if (bl.type === 'steps') {
      for (const s of bl.steps) { parts.push(s.title); parts.push((s.body || []).map((r) => r.t).join('')); }
    }
  }
  const words = parts.join(' ').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

(async () => {
  const { url, key, label } = conn();
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const now = new Date().toISOString();

  const { data: existing } = await admin.from('help_articles').select('id, first_published_at').eq('slug', ARTICLE.slug).maybeSingle();

  const row = Object.assign({}, ARTICLE, {
    pub_topic_id: ARTICLE.topic_id,
    pub_title: ARTICLE.title,
    pub_question: ARTICLE.question,
    pub_lede: ARTICLE.lede,
    pub_blocks: ARTICLE.blocks,
    pub_related_slugs: ARTICLE.related_slugs,
    pub_in_most_asked: ARTICLE.in_most_asked,
    pub_featured_on_topic: ARTICLE.featured_on_topic,
    pub_product_slot: ARTICLE.product_slot,
    pub_reading_minutes: readingMinutes(ARTICLE.lede, ARTICLE.blocks),
    published_at: now,
    first_published_at: (existing && existing.first_published_at) || now,
    draft_dirty: false,
    updated_at: now,
  });

  const { data, error } = await admin.from('help_articles').upsert(row, { onConflict: 'slug' }).select('slug, published_at, pub_reading_minutes').single();
  if (error) { console.error('seed failed: ' + error.message); process.exit(1); }

  console.log('Help Center seed — ' + label);
  console.log('  ' + (existing ? 'updated' : 'created') + ' and published: ' + data.slug +
    '  (' + data.pub_reading_minutes + ' min read)');
  const { count } = await admin.from('help_articles').select('id', { count: 'exact', head: true }).not('published_at', 'is', null);
  console.log('  published articles now: ' + count);
  // ★ process.exitCode, never process.exit() — row 198/215: exiting while supabase-js's handles
  // are still closing aborts libuv on Windows and turns a clean run into a non-zero exit.
  process.exitCode = 0;
})();
