#!/usr/bin/env node
// ★ Product catalog — fund documents, part 2 of 2 (2026-09-12) — backend verification.
//
// Real local stack, real Edge Functions, real Storage. Reuses the harness shape of
// verify-supabase-market-priced-products.js.
//
// ★ THE ASSERTIONS THAT MATTER MOST:
//   1. RLS: a draft is unreadable by any client — by direct table query (no policy exists)
//      AND through get-product-document (404 until published). After publishing, further
//      draft edits stay invisible until published again.
//   2. Sanitisation, proven with a real attempted injection: "<script>" typed into a
//      paragraph is stored as those literal characters; a run carrying an extra key (href,
//      onclick), a block of an unknown type, and a run with a line break are each REFUSED.
//   3. Ordering enforced server-side: a custom section placed after Risks is refused, so is
//      one before Valuation history, so is a missing / duplicated / reordered fixed section.
//   4. The valuation series is exactly this product's nav_publications, and grows by one
//      when a real NAV is published through publish-nav.
//   5. The attachment: uploaded by the PM under the admin storage policy, verified to exist
//      on save, downloadable by a client ONLY through the published document's signed URL —
//      a client cannot sign, list, or upload into the bucket directly.
//
// LOCAL STACK ONLY. Usage:  node scripts/verify-supabase-product-documents.js
const { execSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

let passed = 0, failed = 0;
function check(label, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}
function readLocalStackCredentials() {
  const raw = execSync('supabase status -o json', { cwd: __dirname + '/..', encoding: 'utf8' });
  const status = JSON.parse(raw.slice(raw.indexOf('{')));
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) throw new Error('Refusing to run against a non-local API_URL: ' + status.API_URL);
  return { url: status.API_URL, anonKey: status.ANON_KEY, serviceRoleKey: status.SERVICE_ROLE_KEY };
}
async function signIn(url, anonKey, email, password) {
  const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error('signIn(' + email + ') failed: ' + error.message);
  return { client, token: data.session.access_token };
}
async function callFunction(url, token, name, body) {
  const res = await fetch(url + '/functions/v1/' + name, {
    method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
    body: JSON.stringify(body || {})
  });
  let json = null; try { json = await res.json(); } catch (_e) {}
  return { status: res.status, body: json };
}

const p = (text, marks) => ({ type: 'p', runs: [Object.assign({ t: text }, marks || {})] });
const rt = (...blocks) => ({ blocks });
const SCRIPT_INJECTION = '<script>alert("xss")</script><img src=x onerror="alert(1)">';

function baseSections(overrides) {
  const s = {
    overview: rt(p('Nordic-style growth fund. ' + SCRIPT_INJECTION)),
    strategy: rt(p('Minority positions of 10–25%, held five to seven years.'), { type: 'ul', items: [[{ t: 'Revenue above €5m', b: true }], [{ t: 'Founder-led' }, { t: ' management', i: true }]] }),
    terms: { horizon: '5–7 years', valuationFrequency: 'Quarterly', fees: '2% annual, 20% carried' },
    customs: [{ key: 'custom', heading: 'Portfolio companies', body: rt(p('Fourteen positions.')) }],
    risks: rt(p('Capital is committed for the full horizon.')),
    attachment: null
  };
  Object.assign(s, overrides || {});
  return {
    sections: [
      { key: 'overview', body: s.overview },
      { key: 'strategy', body: s.strategy },
      Object.assign({ key: 'terms' }, s.terms),
      { key: 'valuation' },
      ...s.customs,
      { key: 'risks', body: s.risks },
      { key: 'documents', attachment: s.attachment }
    ]
  };
}

async function main() {
  console.log('Product catalog — fund documents, part 2: backend verification\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(3).toString('hex');
  const password = 'VerifyFundDocs-2026!';
  const pm = await signIn(url, anonKey, 'pm@marketswave.local', 'MarketswavePM-Local-2026!');

  const email = 'fdoc-' + suffix + '@test.marketswave.local';
  const { data: cu, error: cuErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (cuErr) throw new Error(cuErr.message);
  const clientId = cu.user.id;
  await admin.from('clients').insert({ id: clientId, name: 'Fund Doc Reader', email: 'fdoc-' + clientId, phone: '+1', account_type: 'Individual Account', status: 'active' });
  const client = await signIn(url, anonKey, email, password);

  const productId = 'PROD-FD' + suffix.toUpperCase();
  await admin.from('products').insert({ id: productId, name: 'Fund Doc Test PE ' + suffix, asset_class: 'Private Equity', investment_type: 'Growth Fund', risk_tier: 'aggressive', minimum_investment: 10000, unit_price: 120, inception_unit_price: 100, created_at: '2026-01-01', last_tick_date: '2026-06-30', pricing_model: 'appraisal' });
  await admin.from('nav_publications').insert([
    { product_id: productId, published_unit_price: 100, effective_date: '2026-03-31', note: 'seed 1' },
    { product_id: productId, published_unit_price: 120, effective_date: '2026-06-30', note: 'seed 2' }
  ]);
  const storagePath = productId + '/' + crypto.randomUUID() + '/Factsheet-Q2.pdf';
  const fileBytes = Buffer.from('%PDF-1.4 fake factsheet ' + suffix + '\n');

  try {
    console.log('1. Authorization');
    let r = await callFunction(url, null, 'save-product-document', { productId, action: 'save', content: baseSections() });
    check('save-product-document without a token -> 401', r.status === 401, JSON.stringify(r.body));
    r = await callFunction(url, client.token, 'save-product-document', { productId, action: 'save', content: baseSections() });
    check('...as a client -> 403', r.status === 403, JSON.stringify(r.body));
    r = await callFunction(url, client.token, 'get-product-document', { productId, draft: true });
    check('get-product-document {draft:true} as a client -> 403', r.status === 403, JSON.stringify(r.body));
    r = await callFunction(url, null, 'get-product-document', { productId });
    check('get-product-document without a token -> 401', r.status === 401, JSON.stringify(r.body));

    console.log('\n2. A draft is unreadable by any client');
    r = await callFunction(url, pm.token, 'save-product-document', { productId, action: 'save', content: baseSections() });
    check('the PM saves a draft', r.status === 200 && r.body.document.status === 'draft', JSON.stringify(r.body));
    const direct = await client.client.from('product_documents').select('*').eq('product_id', productId);
    check('★ a direct table read as the client returns nothing (no client SELECT policy exists)', !direct.error && direct.data.length === 0, JSON.stringify(direct));
    const directAll = await client.client.from('product_documents').select('product_id');
    check('...nor for any other product', !directAll.error && directAll.data.length === 0, JSON.stringify(directAll));
    r = await callFunction(url, client.token, 'get-product-document', { productId });
    check('★ get-product-document for the draft as the client -> 404', r.status === 404, JSON.stringify(r.body));
    r = await callFunction(url, client.token, 'get-product-document', {});
    check('...and the published list does not include it', r.status === 200 && !r.body.published.some((x) => x.productId === productId), JSON.stringify(r.body));
    r = await callFunction(url, pm.token, 'get-product-document', { productId, draft: true });
    check('the PM reads the draft back (status draft, content present, no published copy)', r.status === 200 && r.body.document.status === 'draft' && r.body.document.content.sections.length === 7 && r.body.document.publishedContent === null, JSON.stringify(r.body).slice(0, 300));
    const ins = await client.client.from('product_documents').insert({ product_id: productId, content: {} });
    check('a client cannot write the table at all', !!ins.error, JSON.stringify(ins.data));

    console.log('\n3. Sanitisation — a real attempted injection');
    const savedOverview = r.body.document.content.sections[0].body;
    check('★ the injected "<script>…" is stored as LITERAL TEXT in a run (t only)', savedOverview.blocks[0].runs[0].t === 'Nordic-style growth fund. ' + SCRIPT_INJECTION && Object.keys(savedOverview.blocks[0].runs[0]).join() === 't', JSON.stringify(savedOverview));
    r = await callFunction(url, pm.token, 'save-product-document', { productId, action: 'save', content: baseSections({ overview: { blocks: [{ type: 'p', runs: [{ t: 'x', href: 'javascript:alert(1)' }] }] } }) });
    check('★ a run carrying an extra key (href) is REFUSED, not stripped', r.status === 400 && /unknown run key "href"/.test(r.body.error), JSON.stringify(r.body));
    r = await callFunction(url, pm.token, 'save-product-document', { productId, action: 'save', content: baseSections({ overview: { blocks: [{ type: 'p', runs: [{ t: 'x', onclick: 'alert(1)' }] }] } }) });
    check('...so is onclick', r.status === 400 && /unknown run key "onclick"/.test(r.body.error), JSON.stringify(r.body));
    r = await callFunction(url, pm.token, 'save-product-document', { productId, action: 'save', content: baseSections({ overview: { blocks: [{ type: 'html', raw: '<script>' }] } }) });
    check('...a block of an unknown type ("html")', r.status === 400 && /block type must be/.test(r.body.error), JSON.stringify(r.body));
    r = await callFunction(url, pm.token, 'save-product-document', { productId, action: 'save', content: baseSections({ overview: { blocks: [{ type: 'p', runs: [{ t: 'x', b: 'yes' }] }] } }) });
    check('...a mark that is not literally true', r.status === 400 && /"b" may only be true/.test(r.body.error), JSON.stringify(r.body));
    r = await callFunction(url, pm.token, 'save-product-document', { productId, action: 'save', content: baseSections({ overview: { blocks: [{ type: 'p', runs: [{ t: 'line\none' }] }] } }) });
    check('...a run containing a line break', r.status === 400 && /line breaks/.test(r.body.error), JSON.stringify(r.body));
    r = await callFunction(url, pm.token, 'save-product-document', { productId, action: 'save', content: baseSections({ overview: { blocks: [], style: 'x' } }) });
    check('...an unknown key on the rich-text object itself', r.status === 400 && /unknown key "style"/.test(r.body.error), JSON.stringify(r.body));
    r = await callFunction(url, pm.token, 'save-product-document', { productId, action: 'save', content: { sections: baseSections().sections, extra: 1 } });
    check('...an unknown key on the document', r.status === 400 && /Unknown document key/.test(r.body.error), JSON.stringify(r.body));

    console.log('\n4. Character caps');
    r = await callFunction(url, pm.token, 'save-product-document', { productId, action: 'save', content: baseSections({ overview: rt(p('a'.repeat(600))) }) });
    check('overview at exactly 600 characters is accepted', r.status === 200, JSON.stringify(r.body).slice(0, 200));
    r = await callFunction(url, pm.token, 'save-product-document', { productId, action: 'save', content: baseSections({ overview: rt(p('a'.repeat(300)), p('b'.repeat(300))) }) });
    check('...two 300-char paragraphs count as 601 (the boundary is a character) -> refused', r.status === 400 && /at most 600 characters \(currently 601\)/.test(r.body.error), JSON.stringify(r.body));
    r = await callFunction(url, pm.token, 'save-product-document', { productId, action: 'save', content: baseSections({ strategy: rt(p('s'.repeat(2001))) }) });
    check('strategy 2,001 -> refused', r.status === 400 && /Strategy must be at most 2,000/.test(r.body.error), JSON.stringify(r.body));
    r = await callFunction(url, pm.token, 'save-product-document', { productId, action: 'save', content: baseSections({ risks: rt(p('r'.repeat(1201))) }) });
    check('risks 1,201 -> refused', r.status === 400 && /Risks must be at most 1,200/.test(r.body.error), JSON.stringify(r.body));
    r = await callFunction(url, pm.token, 'save-product-document', { productId, action: 'save', content: baseSections({ customs: [{ key: 'custom', heading: 'Long', body: rt(p('c'.repeat(5000))) }] }) });
    check('a custom section body of 5,000 characters is accepted (uncapped for a PM)', r.status === 200, JSON.stringify(r.body).slice(0, 200));
    r = await callFunction(url, pm.token, 'save-product-document', { productId, action: 'save', content: baseSections({ customs: [{ key: 'custom', heading: 'h'.repeat(81), body: rt(p('x')) }] }) });
    check('a heading over 80 characters -> refused', r.status === 400 && /heading must be at most 80/.test(r.body.error), JSON.stringify(r.body));

    console.log('\n5. Ordering enforced server-side');
    const good = baseSections();
    const afterRisks = { sections: good.sections.filter((s) => s.key !== 'custom') };
    afterRisks.sections.splice(afterRisks.sections.findIndex((s) => s.key === 'risks') + 1, 0, { key: 'custom', heading: 'Sneaky', body: rt(p('after risks')) });
    r = await callFunction(url, pm.token, 'save-product-document', { productId, action: 'save', content: afterRisks });
    check('★ a custom section placed AFTER Risks is refused', r.status === 400 && /Custom sections must come after Valuation history and before Risks/.test(r.body.error), JSON.stringify(r.body));
    const afterDocs = { sections: good.sections.filter((s) => s.key !== 'custom').concat([{ key: 'custom', heading: 'Last', body: rt(p('after documents')) }]) };
    r = await callFunction(url, pm.token, 'save-product-document', { productId, action: 'save', content: afterDocs });
    check('...after Documents is refused too', r.status === 400 && /Custom sections must come after Valuation history/.test(r.body.error), JSON.stringify(r.body));
    const beforeVal = { sections: good.sections.filter((s) => s.key !== 'custom') };
    beforeVal.sections.splice(1, 0, { key: 'custom', heading: 'Early', body: rt(p('before strategy')) });
    r = await callFunction(url, pm.token, 'save-product-document', { productId, action: 'save', content: beforeVal });
    check('...and one BEFORE Valuation history is refused', r.status === 400 && /Custom sections must come after Valuation history/.test(r.body.error), JSON.stringify(r.body));
    const swapped = { sections: good.sections.slice() };
    const iR = swapped.sections.findIndex((s) => s.key === 'risks'), iD = swapped.sections.findIndex((s) => s.key === 'documents');
    [swapped.sections[iR], swapped.sections[iD]] = [swapped.sections[iD], swapped.sections[iR]];
    r = await callFunction(url, pm.token, 'save-product-document', { productId, action: 'save', content: swapped });
    check('Documents before Risks is refused (fixed order)', r.status === 400 && /Fixed sections must appear in this order/.test(r.body.error), JSON.stringify(r.body));
    r = await callFunction(url, pm.token, 'save-product-document', { productId, action: 'save', content: { sections: good.sections.filter((s) => s.key !== 'risks') } });
    check('a missing Risks section is refused', r.status === 400 && /"risks" section is missing/.test(r.body.error), JSON.stringify(r.body));
    r = await callFunction(url, pm.token, 'save-product-document', { productId, action: 'save', content: { sections: good.sections.concat([{ key: 'documents', attachment: null }]) } });
    check('a duplicated fixed section is refused', r.status === 400 && /appears more than once/.test(r.body.error), JSON.stringify(r.body));
    const authoredVal = { sections: good.sections.map((s) => s.key === 'valuation' ? { key: 'valuation', body: rt(p('made up')) } : s) };
    r = await callFunction(url, pm.token, 'save-product-document', { productId, action: 'save', content: authoredVal });
    check('an AUTHORED Valuation history is refused (it is generated, never written)', r.status === 400 && /generated from published NAVs and cannot be authored/.test(r.body.error), JSON.stringify(r.body));
    const three = baseSections({ customs: [
      { key: 'custom', heading: 'One', body: rt(p('1')) }, { key: 'custom', heading: 'Two', body: rt(p('2')) }, { key: 'custom', heading: 'Three', body: rt(p('3')) }
    ] });
    r = await callFunction(url, pm.token, 'save-product-document', { productId, action: 'save', content: three });
    const keysBack = r.body.document.content.sections.map((s) => s.key === 'custom' ? 'custom:' + s.heading : s.key).join(',');
    check('three custom sections in the right slot round-trip in the PM\'s order', r.status === 200 && keysBack === 'overview,strategy,terms,valuation,custom:One,custom:Two,custom:Three,risks,documents', keysBack);

    console.log('\n6. Publishing');
    r = await callFunction(url, pm.token, 'save-product-document', { productId, action: 'publish', content: baseSections({ risks: rt() }) });
    check('publishing with an empty Risks is refused, naming what is missing', r.status === 400 && /required before publishing: Risks/.test(r.body.error), JSON.stringify(r.body));
    r = await callFunction(url, pm.token, 'save-product-document', { productId, action: 'publish', content: baseSections({ terms: { horizon: '', valuationFrequency: 'Quarterly', fees: '2%' } }) });
    check('...or an empty Expected horizon', r.status === 400 && /Expected horizon/.test(r.body.error), JSON.stringify(r.body));
    r = await callFunction(url, pm.token, 'save-product-document', { productId, action: 'publish', content: baseSections({ customs: [{ key: 'custom', heading: '', body: rt(p('no heading')) }] }) });
    check('...or a custom section without a heading', r.status === 400 && /custom section/.test(r.body.error), JSON.stringify(r.body));
    r = await callFunction(url, pm.token, 'save-product-document', { productId, action: 'unpublish' });
    check('unpublishing a never-published document -> 409', r.status === 409, JSON.stringify(r.body));
    r = await callFunction(url, pm.token, 'save-product-document', { productId, action: 'publish', content: baseSections() });
    check('★ publishing a complete document succeeds with attribution', r.status === 200 && r.body.document.status === 'published' && r.body.document.publishedByEmail === 'pm@marketswave.local' && !!r.body.document.publishedAt, JSON.stringify(r.body).slice(0, 300));
    r = await callFunction(url, client.token, 'get-product-document', {});
    check('the published list now includes it', r.body.published.some((x) => x.productId === productId), JSON.stringify(r.body));
    r = await callFunction(url, client.token, 'get-product-document', { productId });
    const pub = r.body;
    check('★ the client reads the published document', r.status === 200 && Array.isArray(pub.document.sections) && pub.document.sections.length === 7, JSON.stringify(pub).slice(0, 200));
    const prodRow = (await admin.from('products').select('*').eq('id', productId).single()).data;
    check('...hero figures come from the PRODUCT row: unit price, last valued, minimum, class, name', pub.product.unitPrice === Number(prodRow.unit_price) && pub.product.lastTickDate === prodRow.last_tick_date && pub.product.minimumInvestment === 10000 && pub.product.assetClass === 'Private Equity' && pub.product.name === prodRow.name, JSON.stringify(pub.product));
    check('...the injection text arrives as literal text, still with no key but t', pub.document.sections[0].body.blocks[0].runs[0].t.indexOf('<script>') !== -1 && Object.keys(pub.document.sections[0].body.blocks[0].runs[0]).join() === 't');
    check('...the response carries no draft copy', !('content' in pub.document) && !('publishedContent' in pub.document), Object.keys(pub.document).join());
    direct2 = await client.client.from('product_documents').select('*').eq('product_id', productId);
    check('a direct table read is STILL empty for the client after publishing (they only ever get the function\'s published view)', !direct2.error && direct2.data.length === 0);

    console.log('\n7. Draft edits after publishing stay invisible until published again');
    r = await callFunction(url, pm.token, 'save-product-document', { productId, action: 'save', content: baseSections({ overview: rt(p('EDITED overview, not yet published')) }) });
    check('the PM saves an edit to the live document', r.status === 200 && r.body.document.status === 'published', JSON.stringify(r.body).slice(0, 200));
    r = await callFunction(url, client.token, 'get-product-document', { productId });
    check('★ the client still reads the ORIGINAL overview', r.body.document.sections[0].body.blocks[0].runs[0].t.indexOf('Nordic-style') === 0, JSON.stringify(r.body.document.sections[0]));
    r = await callFunction(url, pm.token, 'get-product-document', { productId, draft: true });
    check('...while the PM\'s draft carries the edit', r.body.document.content.sections[0].body.blocks[0].runs[0].t === 'EDITED overview, not yet published' && r.body.document.publishedContent.sections[0].body.blocks[0].runs[0].t.indexOf('Nordic-style') === 0);
    r = await callFunction(url, pm.token, 'save-product-document', { productId, action: 'publish', content: baseSections({ overview: rt(p('EDITED overview, now published')) }) });
    r = await callFunction(url, client.token, 'get-product-document', { productId });
    check('after publishing again the client reads the edit', r.body.document.sections[0].body.blocks[0].runs[0].t === 'EDITED overview, now published');

    console.log('\n8. Valuation history = this product\'s nav_publications');
    check('two seeded NAVs -> two points, oldest first, from/to/count correct', pub.valuation.source === 'nav' && pub.valuation.count === 2 && pub.valuation.points[0].date === '2026-03-31' && pub.valuation.points[0].price === 100 && pub.valuation.points[1].price === 120 && pub.valuation.from === '2026-03-31' && pub.valuation.to === '2026-06-30', JSON.stringify(pub.valuation));
    const navR = await callFunction(url, pm.token, 'publish-nav', { productId, changePercent: 5, effectiveDate: '2026-09-30', note: 'verify' });
    check('a real NAV published through publish-nav (+5%)', navR.status === 200 && navR.body.product.unitPrice === 126, JSON.stringify(navR.body).slice(0, 200));
    r = await callFunction(url, client.token, 'get-product-document', { productId });
    check('★ the series grew by exactly that publication, and the hero unit price moved with the product', r.body.valuation.count === 3 && r.body.valuation.points[2].date === '2026-09-30' && r.body.valuation.points[2].price === 126 && r.body.product.unitPrice === 126 && r.body.product.lastTickDate === '2026-09-30', JSON.stringify(r.body.valuation));
    const dbNavs = (await admin.from('nav_publications').select('effective_date, published_unit_price').eq('product_id', productId).order('effective_date')).data;
    check('...and matches the table row for row', JSON.stringify(dbNavs.map((n) => [n.effective_date, Number(n.published_unit_price)])) === JSON.stringify(r.body.valuation.points.map((x) => [x.date, x.price])));
    r = await callFunction(url, pm.token, 'get-product-document', { productId: 'PROD-0004', draft: true });
    check('★ a MARKET-priced product (Ethereum) has NO valuation series (source none, zero points) — the section is omitted, never an empty chart', r.status === 200 && r.body.valuation.source === 'none' && r.body.valuation.count === 0 && r.body.product.pricingModel === 'market' && !!r.body.product.priceAsOf, JSON.stringify(r.body.valuation));

    console.log('\n9. The attachment');
    const badPath = await callFunction(url, pm.token, 'save-product-document', { productId, action: 'save', content: baseSections({ attachment: { path: 'PROD-0001/' + crypto.randomUUID() + '/x.pdf', name: 'x.pdf', size: 1, contentType: 'application/pdf' } }) });
    check('an attachment path outside this product\'s folder is refused', badPath.status === 400 && /own folder/.test(badPath.body.error), JSON.stringify(badPath.body));
    const ghost = await callFunction(url, pm.token, 'save-product-document', { productId, action: 'save', content: baseSections({ attachment: { path: storagePath, name: 'Factsheet-Q2.pdf', size: 1, contentType: 'application/pdf' } }) });
    check('an attachment that was never uploaded is refused', ghost.status === 400 && /not found in storage/.test(ghost.body.error), JSON.stringify(ghost.body));
    const cUp = await client.client.storage.from('fund-documents').upload(productId + '/hack/evil.pdf', fileBytes, { contentType: 'application/pdf' });
    check('a client cannot upload into the bucket', !!cUp.error, JSON.stringify(cUp.data));
    const up = await pm.client.storage.from('fund-documents').upload(storagePath, fileBytes, { contentType: 'application/pdf' });
    check('the PM uploads the factsheet under the admin policy', !up.error, up.error && up.error.message);
    const att = { path: storagePath, name: 'Factsheet-Q2.pdf', size: fileBytes.length, contentType: 'application/pdf' };
    r = await callFunction(url, pm.token, 'save-product-document', { productId, action: 'publish', content: baseSections({ attachment: att }) });
    check('publishing with the real attachment succeeds', r.status === 200, JSON.stringify(r.body).slice(0, 200));
    r = await callFunction(url, client.token, 'get-product-document', { productId });
    check('the client gets the attachment\'s name/size/type and a signed path', r.body.attachment && r.body.attachment.name === 'Factsheet-Q2.pdf' && r.body.attachment.size === fileBytes.length && typeof r.body.attachment.signedPath === 'string' && /^\/storage\/v1\/object\/sign\//.test(r.body.attachment.signedPath), JSON.stringify(r.body.attachment));
    // The function's own SUPABASE_URL is the stack-internal address; the page prepends the
    // project URL it is configured with — done here exactly as fund-document.html does it.
    const dl = await fetch(url + r.body.attachment.signedPath);
    const got = Buffer.from(await dl.arrayBuffer());
    check('★ downloading it returns the exact bytes the PM uploaded', dl.status === 200 && got.equals(fileBytes), dl.status + ' ' + got.length);
    const cSign = await client.client.storage.from('fund-documents').createSignedUrl(storagePath, 60);
    check('a client cannot sign a URL for the object directly (no client SELECT policy on the bucket)', !!cSign.error, JSON.stringify(cSign.data));
    const cList = await client.client.storage.from('fund-documents').list(productId);
    check('...nor list the product\'s folder', !!cList.error || (cList.data || []).length === 0, JSON.stringify(cList.data));

    console.log('\n10. Unpublish');
    r = await callFunction(url, pm.token, 'save-product-document', { productId, action: 'unpublish' });
    check('the PM unpublishes', r.status === 200 && r.body.document.status === 'draft' && r.body.document.publishedContent === null, JSON.stringify(r.body).slice(0, 200));
    r = await callFunction(url, client.token, 'get-product-document', { productId });
    check('★ the client gets 404 again; the draft (attachment included) is kept for the PM', r.status === 404);
    r = await callFunction(url, client.token, 'get-product-document', {});
    check('...and it left the published list', !r.body.published.some((x) => x.productId === productId));
    r = await callFunction(url, pm.token, 'get-product-document', { productId, draft: true });
    check('the working copy survived unpublishing', r.body.document.content.sections.find((s) => s.key === 'documents').attachment.path === storagePath);
  } finally {
    await pm.client.storage.from('fund-documents').remove([storagePath]).catch(() => {});
    await admin.from('product_documents').delete().eq('product_id', productId);
    await admin.from('nav_publications').delete().eq('product_id', productId);
    await admin.from('products').delete().eq('id', productId);
    await admin.from('clients').delete().eq('id', clientId);
    const { error: delErr } = await admin.auth.admin.deleteUser(clientId);
    if (delErr) console.log('  cleanup: could not delete test user: ' + delErr.message);
    const left = (await admin.from('products').select('id').eq('id', productId)).data || [];
    if (left.length) console.log('  cleanup: product still present: ' + productId);
  }

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed. VERIFY: ' + (failed ? 'FAIL' : 'PASS'));
  process.exit(failed ? 1 : 0);
}
let direct2;
main().catch((err) => { console.error('FATAL: ' + (err && err.stack || err)); process.exit(1); });
