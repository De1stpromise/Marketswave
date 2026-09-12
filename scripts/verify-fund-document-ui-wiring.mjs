#!/usr/bin/env node
// ★ Product catalog — fund documents, part 2 of 2 (2026-09-12) — UI verification.
//
// Drives the REAL, unmodified inline scripts of admin-fund-document.html (the PM authoring
// page), fund-document.html (the client render), admin-products.html (the document status in
// the expanded row) and asset-collection.html (the card link) in real jsdom DOMs against the
// real local stack — the harness every UI-wiring stage has used.
//
// ★ WHAT MATTERS MOST HERE:
//   - a real document authored through the real page, saved as a draft, published, and read
//     by a real client through the real client page.
//   - sanitisation at the UI layer, proven with a real attempted injection: what a browser
//     would leave in the contenteditable after a paste of "<script>", an <img onerror>, a
//     styled span and a link is serialised to the model with ONLY text and marks surviving,
//     and the client render contains no script element and paints the text literally.
//   - the counter a PM sees agrees with the cap the server enforces (600 accepted, 601 refused
//     with the server's own message shown inline).
//   - custom sections reorder/delete through the real controls and land in the right slot,
//     between Valuation history and Risks, in the PM's order — on the client page too.
//   - the client page shows "No document published" for a draft, and the card link exists only
//     for a published document.
//
// jsdom has no document.execCommand, so the editor's DOM is set the way a browser would leave
// it after typing/pasting and an input event is dispatched — the real serialiser then runs.
//
// LOCAL STACK ONLY. Usage:
//   node --experimental-loader ./lib/esm-loader-supabase-cdn.mjs verify-fund-document-ui-wiring.mjs
import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

let passed = 0, failed = 0;
function check(label, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}
async function pollUntil(test, maxMs) {
  const start = Date.now();
  while (Date.now() - start < maxMs) { if (await test()) return true; await new Promise((r) => setTimeout(r, 150)); }
  return test();
}
function readLocalStackCredentials() {
  const scriptsDir = fileURLToPath(new URL('.', import.meta.url));
  const raw = execSync('supabase status -o json', { cwd: scriptsDir + '/..', encoding: 'utf8' });
  const status = JSON.parse(raw.slice(raw.indexOf('{')));
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) throw new Error('Refusing to run against a non-local API_URL: ' + status.API_URL);
  return { url: status.API_URL, anonKey: status.ANON_KEY, serviceRoleKey: status.SERVICE_ROLE_KEY };
}
function extractInlineScript(htmlPath, marker) {
  const html = readFileSync(htmlPath, 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const target = scripts.find((s) => s.indexOf(marker) !== -1);
  if (!target) throw new Error('Could not find a script containing "' + marker + '" in ' + htmlPath);
  return target;
}
function extractBodyMarkup(htmlPath) {
  const html = readFileSync(htmlPath, 'utf8');
  const m = html.match(/<body[^>]*>([\s\S]*)<\/body>/);
  return m[1].replace(/<script[\s\S]*?<\/script>/g, '');
}
const vc = new VirtualConsole(); vc.forwardTo(console);
function buildPageDom(htmlPath, pageUrl) {
  return new JSDOM('<!doctype html><html><body>' + extractBodyMarkup(htmlPath) + '</body></html>', { url: pageUrl || 'http://localhost/', runScripts: 'outside-only', virtualConsole: vc });
}

async function main() {
  console.log('Product catalog — fund documents, part 2: real UI verification\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(3).toString('hex');
  const password = 'VerifyFundDocUI-2026!';

  globalThis.window = { location: { hostname: '127.0.0.1', search: '' } };
  await import('../supabase-data.js');
  const MarketswaveData = globalThis.window.MarketswaveData;
  const root = new URL('../', import.meta.url);
  const src = (f) => readFileSync(fileURLToPath(new URL(f, root)), 'utf8');
  const engineCoreSource = src('engine-core.js');
  const formatHelpersSource = src('format-helpers.js');
  const richTextSource = src('rich-text.js');
  const fundDocSource = src('fund-document.js');
  const uploadSource = src('upload-control.js');

  const email = 'fdui-' + suffix + '@test.marketswave.local';
  const { data: cu, error: cuErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (cuErr) throw new Error(cuErr.message);
  const clientId = cu.user.id;
  await admin.from('clients').insert({ id: clientId, name: 'Fund Doc UI Reader', email: 'fdui-' + clientId, phone: '+1', account_type: 'Individual Account', status: 'active' });
  await admin.from('account_state').insert({ client_id: clientId, unallocated_capital: 50000, allocated_capital: 0, asset_returns: 0 });

  const productId = 'PROD-FU' + suffix.toUpperCase();
  await admin.from('products').insert({ id: productId, name: 'Fund Doc UI Fund ' + suffix, asset_class: 'Private Equity', investment_type: 'Growth Fund', risk_tier: 'aggressive', minimum_investment: 10000, unit_price: 132.5, inception_unit_price: 100, created_at: '2026-01-01', last_tick_date: '2026-06-30', pricing_model: 'appraisal' });
  await admin.from('nav_publications').insert([
    { product_id: productId, published_unit_price: 100, effective_date: '2026-03-31', note: 'seed' },
    { product_id: productId, published_unit_price: 132.5, effective_date: '2026-06-30', note: 'seed' }
  ]);
  let uploadedPath = null;

  try {
    // ===== PART A: the PM authoring page =====
    console.log('=== PART A: admin-fund-document.html — author, draft, publish ===\n');
    const adminConfigMod = await import('../admin-supabase-config.js');
    const { error: pmErr } = await adminConfigMod.supabase.auth.signInWithPassword({ email: adminConfigMod.LOCAL_ADMIN_EMAIL, password: adminConfigMod.LOCAL_ADMIN_PASSWORD });
    check('real PM sign-in', !pmErr, pmErr && pmErr.message);
    await MarketswaveData.useAdminClient();

    const afdPath = fileURLToPath(new URL('admin-fund-document.html', root));
    function loadAuthoring() {
      const dom = buildPageDom(afdPath, 'http://localhost/admin-fund-document.html?product=' + productId);
      dom.window.MarketswaveData = MarketswaveData;
      dom.window.eval(uploadSource);
      dom.window.eval(richTextSource);
      dom.window.eval(fundDocSource);
      dom.window.eval(extractInlineScript(afdPath, 'the authoring page'));
      return dom;
    }
    let dom = loadAuthoring();
    let D = dom.window.document;
    const formReady = await pollUntil(() => !D.getElementById('doc-form').classList.contains('hidden'), 30000);
    check('the authoring page loads the product and shows the form', formReady, D.getElementById('doc-loading').textContent);
    check('the title names the product', D.getElementById('doc-title').textContent === 'Fund Doc UI Fund ' + suffix + ' · fund document', D.getElementById('doc-title').textContent);
    check('status chip: "Not yet saved" for a product with no document', D.getElementById('doc-status-chip').textContent === 'Not yet saved', D.getElementById('doc-status-chip').textContent);
    check('★ the Valuation history section is NOT authored — the PM sees a note stating the real count and date range (2, 31 Mar–30 Jun 2026)', /currently 2, from 31 Mar 2026 to 30 Jun 2026/.test(D.getElementById('valuation-note').textContent) && !D.querySelector('[data-section="valuation"] .rte-body'), D.getElementById('valuation-note').textContent);
    check('the Terms minimum investment is read from the PRODUCT and is not an input', D.getElementById('terms-minimum').textContent === '$10,000' && D.getElementById('terms-minimum').tagName === 'P', D.getElementById('terms-minimum').textContent);
    const RT = dom.window.MarketswaveRichText;

    // --- fill the editors the way a browser would leave a contenteditable ---
    function setEditor(id, html) { const b = D.querySelector('#' + id + ' .rte-body'); b.innerHTML = html; b.dispatchEvent(new dom.window.Event('input', { bubbles: true })); return b; }
    const INJECTION = '<script>alert("xss")</script>';
    // A paste a browser might leave behind if paste were NOT intercepted: a script element,
    // an image with an onerror handler, a styled span, a link. Only text and marks may survive.
    setEditor('ed-overview', '<p>Nordic-style growth fund. <b>Series B and beyond.</b> ' + INJECTION.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</p><p><img src="x" onerror="window.__pwned=1"><span style="font-weight:700">Bold via style</span> <a href="javascript:alert(1)">a link</a><script>window.__pwned=1</script></p>');
    const ovModel = RT.fromEditor(D.querySelector('#ed-overview .rte-body'));
    check('★ the serialiser keeps ONLY text and marks: no element, attribute or URL survives', JSON.stringify(ovModel) === JSON.stringify({ blocks: [
      { type: 'p', runs: [{ t: 'Nordic-style growth fund. ' }, { t: 'Series B and beyond.', b: true }, { t: ' ' + INJECTION }] },
      { type: 'p', runs: [{ t: 'Bold via style', b: true }, { t: ' a link' }] }
    ] }), JSON.stringify(ovModel));
    check('...the counter reflects the real length ("N / 600 characters")', /^\d+ \/ 600 characters$/.test(D.querySelector('#ed-overview .rte-counter').textContent), D.querySelector('#ed-overview .rte-counter').textContent);
    check('...and the chip now reads "Unsaved changes"', D.getElementById('doc-status-chip').textContent === 'Unsaved changes');
    setEditor('ed-strategy', '<p>Minority positions of 10–25%, held five to seven years.</p><ul><li><b>Revenue above €5m</b></li><li>Founder-led <i>management</i></li></ul><ol><li>First</li><li>Second</li></ol>');
    const stModel = RT.fromEditor(D.querySelector('#ed-strategy .rte-body'));
    check('bulleted and numbered lists serialise as ul/ol blocks with their items', stModel.blocks.length === 3 && stModel.blocks[1].type === 'ul' && stModel.blocks[1].items.length === 2 && stModel.blocks[1].items[0][0].b === true && stModel.blocks[2].type === 'ol' && stModel.blocks[2].items[1][0].t === 'Second', JSON.stringify(stModel));
    D.getElementById('terms-horizon').value = '5–7 years'; D.getElementById('terms-horizon').dispatchEvent(new dom.window.Event('input'));
    D.getElementById('terms-frequency').value = 'Quarterly'; D.getElementById('terms-frequency').dispatchEvent(new dom.window.Event('change'));
    D.getElementById('terms-fees').value = '2% annual, 20% carried'; D.getElementById('terms-fees').dispatchEvent(new dom.window.Event('input'));

    // --- custom sections: add three, reorder, delete ---
    D.getElementById('add-section-btn').click(); D.getElementById('add-section-btn').click(); D.getElementById('add-section-btn').click();
    let custs = () => [...D.querySelectorAll('#custom-sections .sect.cust')];
    check('three custom sections added through the real button', custs().length === 3);
    custs().forEach((c, i) => { c.querySelector('.htitle').value = ['Portfolio companies', 'Track record', 'Governance'][i]; c.querySelector('.htitle').dispatchEvent(new dom.window.Event('input')); const b = c.querySelector('.rte-body'); b.innerHTML = '<p>' + ['Fourteen positions.', 'Three prior vehicles.', 'Quarterly board.'][i] + '</p>'; b.dispatchEvent(new dom.window.Event('input')); });
    check('the first section\'s "up" and the last\'s "down" are disabled', custs()[0].querySelector('.cust-up').disabled && custs()[2].querySelector('.cust-down').disabled && !custs()[1].querySelector('.cust-up').disabled);
    custs()[2].querySelector('.cust-up').click();   // Governance up one
    check('"Move up" reorders through the real control', custs().map((c) => c.querySelector('.htitle').value).join(',') === 'Portfolio companies,Governance,Track record', custs().map((c) => c.querySelector('.htitle').value).join(','));
    custs()[2].querySelector('.cust-del').click();  // delete Track record
    check('"Delete" removes through the real control', custs().length === 2 && custs().map((c) => c.querySelector('.htitle').value).join(',') === 'Portfolio companies,Governance');

    // --- save draft ---
    D.getElementById('doc-save-btn').click();
    const savedChip = await pollUntil(() => /Draft · saved/.test(D.getElementById('doc-status-chip').textContent) || !D.getElementById('doc-error').classList.contains('hidden'), 30000);
    check('★ Save draft: the chip reads "Draft · saved HH:MM" and the toast confirms', savedChip && /Draft · saved \d\d:\d\d/.test(D.getElementById('doc-status-chip').textContent) && D.getElementById('admin-toast-title').textContent === 'Draft saved', D.getElementById('doc-status-chip').textContent + ' | ' + D.getElementById('doc-error').textContent);
    let row = (await admin.from('product_documents').select('*').eq('product_id', productId).single()).data;
    check('...a real product_documents row exists, status draft, no published copy', !!row && row.status === 'draft' && row.published_content === null);
    check('...whose sections are in canonical order with the customs in the PM\'s order between valuation and risks', row.content.sections.map((s) => s.key === 'custom' ? 'custom:' + s.heading : s.key).join(',') === 'overview,strategy,terms,valuation,custom:Portfolio companies,custom:Governance,risks,documents', row.content.sections.map((s) => s.key).join(','));
    check('...and the injection is stored as literal text with no key but t', row.content.sections[0].body.blocks[0].runs[2].t === ' ' + INJECTION && Object.keys(row.content.sections[0].body.blocks[0].runs[2]).join() === 't');

    // --- the cap: 600 accepted, 601 refused with the server's own message inline ---
    setEditor('ed-overview', '<p>' + 'a'.repeat(600) + '</p>');
    check('the counter reads exactly "600 / 600 characters" and is not flagged over', D.querySelector('#ed-overview .rte-counter').textContent === '600 / 600 characters' && !D.querySelector('#ed-overview .rte-counter').classList.contains('over'));
    D.getElementById('doc-save-btn').click();
    await pollUntil(() => D.getElementById('admin-toast-title').textContent === 'Draft saved' && !D.getElementById('doc-status-chip').classList.contains('dirty'), 30000);
    check('★ 600 characters: the server accepts (client counter and server cap agree at the boundary)', /Draft · saved/.test(D.getElementById('doc-status-chip').textContent) && D.getElementById('doc-error').classList.contains('hidden'));
    setEditor('ed-overview', '<p>' + 'a'.repeat(300) + '</p><p>' + 'b'.repeat(300) + '</p>');
    check('...two 300-char paragraphs: the counter reads 601 and turns "over"', D.querySelector('#ed-overview .rte-counter').textContent === '601 / 600 characters' && D.querySelector('#ed-overview .rte-counter').classList.contains('over'));
    D.getElementById('doc-save-btn').click();
    const errShown = await pollUntil(() => !D.getElementById('doc-error').classList.contains('hidden'), 30000);
    check('★ 601: the server refuses and its own message is shown inline', errShown && /Overview must be at most 600 characters \(currently 601\)/.test(D.getElementById('doc-error').textContent), D.getElementById('doc-error').textContent);
    setEditor('ed-overview', '<p>Nordic-style growth fund. <b>Series B and beyond.</b> ' + INJECTION.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</p>');

    // --- the attachment: a real file through the real input ---
    const fileBytes = Buffer.from('%PDF-1.4 ui factsheet ' + suffix + '\n');
    const input = D.getElementById('attachment-file');
    const file = new File([fileBytes], 'Factsheet Q2 2026.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    const uploaded = await pollUntil(() => !D.getElementById('attachment-current').classList.contains('hidden') || !D.getElementById('attachment-file-error').hidden, 30000);
    check('★ choosing a file uploads it and shows it as the current attachment', uploaded && D.getElementById('attachment-name').textContent === 'Factsheet Q2 2026.pdf' && /pdf/.test(D.getElementById('attachment-meta').textContent), D.getElementById('attachment-file-error').textContent);
    const objs = (await admin.storage.from('fund-documents').list(productId)).data || [];
    check('...a real object landed in the product\'s own folder of the fund-documents bucket', objs.length === 1, JSON.stringify(objs.map((o) => o.name)));

    // --- publish: refused while Risks is empty, then succeeds ---
    D.getElementById('doc-publish-btn').click();
    const pubErr = await pollUntil(() => /required before publishing/.test(D.getElementById('doc-error').textContent) && !D.getElementById('doc-error').classList.contains('hidden'), 30000);
    check('★ Publish with an empty Risks is refused, naming it', pubErr && /Risks/.test(D.getElementById('doc-error').textContent), D.getElementById('doc-error').textContent);
    setEditor('ed-risks', '<p>Capital is committed for the full horizon and cannot be withdrawn early.</p>');
    D.getElementById('doc-publish-btn').click();
    const published = await pollUntil(() => /^Published /.test(D.getElementById('doc-status-chip').textContent), 30000);
    check('★ Publish succeeds: the chip reads "Published <date>", the button now reads "Publish changes", Unpublish appears', published && D.getElementById('doc-publish-btn').textContent === 'Publish changes' && !D.getElementById('doc-unpublish-btn').classList.contains('hidden'), D.getElementById('doc-status-chip').textContent + ' | ' + D.getElementById('doc-error').textContent);
    row = (await admin.from('product_documents').select('*').eq('product_id', productId).single()).data;
    uploadedPath = row.content.sections.find((s) => s.key === 'documents').attachment.path;
    check('...the row is published with the PM\'s attribution and the attachment in the frozen copy', row.status === 'published' && row.published_by_email === 'pm@marketswave.local' && row.published_content.sections.find((s) => s.key === 'documents').attachment.path === uploadedPath);

    // --- preview: the draft through the client renderer ---
    D.getElementById('doc-preview-btn').click();
    const previewed = await pollUntil(() => D.querySelectorAll('#preview-root .fd-section').length > 0, 15000);
    const pHeads = [...D.querySelectorAll('#preview-root .fd-section h2')].map((h) => h.textContent);
    check('★ Preview renders the fixed sections and the custom ones in the enforced order', previewed && pHeads.join('|') === 'Overview|Strategy|Terms & liquidity|Valuation history|Portfolio companies|Governance|Risks|Documents', pHeads.join('|'));
    check('...a reader cannot tell a custom section from a fixed one (same element, same class)', D.querySelectorAll('#preview-root .fd-section').length === 8 && [...D.querySelectorAll('#preview-root .fd-section')].every((s) => s.className === 'fd-section'));
    check('...the injection is painted as literal text; no <script> element exists in the render', !D.querySelector('#preview-root script') && D.querySelector('#preview-root .fd-section p').textContent.indexOf(INJECTION) !== -1 && !!D.querySelector('#preview-root .fd-section p strong'));
    check('...the hero figures come from the product (unit price $132.50, minimum $10,000, last valued 30 Jun 2026) and the horizon from Terms', D.querySelector('#preview-root .fd-hero').textContent.indexOf('$132.50') !== -1 && D.querySelector('#preview-root .fd-hero').textContent.indexOf('$10,000') !== -1 && D.querySelector('#preview-root .fd-hero').textContent.indexOf('30 Jun 2026') !== -1 && D.querySelector('#preview-root .fd-hero').textContent.indexOf('5–7 years') !== -1);
    check('...the terms table has four cells, minimum from the product', [...D.querySelectorAll('#preview-root .fd-terms .fd-term-v')].map((v) => v.textContent).join('|') === '$10,000|5–7 years|Quarterly|2% annual, 20% carried', [...D.querySelectorAll('#preview-root .fd-terms .fd-term-v')].map((v) => v.textContent).join('|'));
    check('...the valuation history lists both real NAVs (jsdom has no canvas — the table fallback) and the +32.5% since first valuation', [...D.querySelectorAll('#preview-root .fd-chart-table td')].map((t) => t.textContent).join('|') === '31 Mar 2026|$100.00|30 Jun 2026|$132.50' && D.querySelector('#preview-root .fd-chart-b').textContent === '+32.5%', [...D.querySelectorAll('#preview-root .fd-chart-table td')].map((t) => t.textContent).join('|'));
    check('...the risks sit in the accented callout and the download row names the file', !!D.querySelector('#preview-root .fd-risk p') && D.querySelector('#preview-root .fd-dl-nm b').textContent === 'Factsheet Q2 2026.pdf' && !!D.querySelector('#preview-root .fd-dl-btn'));
    check('...the disclosure footer carries the two existing paragraphs verbatim and links to the full disclosures', D.querySelectorAll('#preview-root .fd-foot p').length === 3 && D.querySelector('#preview-root .fd-foot-more a').getAttribute('href') === 'legal.html#disclosures');
    D.getElementById('preview-close').click();

    // --- reload: the draft comes back populated ---
    dom = loadAuthoring(); D = dom.window.document;
    await pollUntil(() => !D.getElementById('doc-form').classList.contains('hidden'), 30000);
    check('reloading the page repopulates every field from the saved document', D.querySelector('#ed-overview .rte-body p strong') && D.querySelector('#ed-overview .rte-body p strong').textContent === 'Series B and beyond.' && D.getElementById('terms-fees').value === '2% annual, 20% carried' && [...D.querySelectorAll('#custom-sections .htitle')].map((h) => h.value).join(',') === 'Portfolio companies,Governance' && D.getElementById('attachment-name').textContent === 'Factsheet Q2 2026.pdf' && /^Published /.test(D.getElementById('doc-status-chip').textContent), D.getElementById('doc-status-chip').textContent);

    // ===== PART B: admin-products.html shows the document status =====
    console.log('\n=== PART B: admin-products.html — status in the expanded row ===\n');
    const apPath = fileURLToPath(new URL('admin-products.html', root));
    const apDom = buildPageDom(apPath);
    apDom.window.MarketswaveData = MarketswaveData;
    apDom.window.eval(formatHelpersSource);
    apDom.window.eval(extractInlineScript(apPath, 'Products Catalog Fix'));
    const P = apDom.window.document;
    await pollUntil(() => P.querySelectorAll('.product-row').length > 0, 30000);
    [...P.querySelectorAll('.product-row')].find((x) => x.dataset.id === productId).click();
    const block = P.getElementById('fund-doc-' + productId);
    check('the expanded row shows "Published <date>" and an "Edit document" link to the authoring page', !!block && /^Published /.test(block.querySelector('.fund-doc-status').textContent) && block.querySelector('.fund-doc-link').textContent === 'Edit document' && block.querySelector('.fund-doc-link').getAttribute('href') === 'admin-fund-document.html?product=' + productId, block && block.textContent);
    [...P.querySelectorAll('.product-row')].find((x) => x.dataset.id === 'PROD-0002').click();
    const block2 = P.getElementById('fund-doc-PROD-0002');
    check('a product with no document shows "No document yet" and "Write document"', !!block2 && /No document yet/.test(block2.textContent) && block2.querySelector('.fund-doc-link').textContent === 'Write document', block2 && block2.textContent);

    // ===== PART C: the client =====
    console.log('\n=== PART C: fund-document.html + asset-collection.html as a real client ===\n');
    const { error: cErr } = await adminConfigMod.supabase.auth.signInWithPassword({ email, password });
    check('real client sign-in on the shared singleton', !cErr, cErr && cErr.message);

    const fdPath = fileURLToPath(new URL('fund-document.html', root));
    function loadClientPage(pid) {
      const d = buildPageDom(fdPath, 'http://localhost/fund-document.html?product=' + pid);
      d.window.MarketswaveData = MarketswaveData;
      d.window.getAuthenticatedClientId = () => clientId;
      d.window.eval(richTextSource);
      d.window.eval(fundDocSource);
      d.window.eval(extractInlineScript(fdPath, 'the client-facing render'));
      return d;
    }
    let cd = loadClientPage(productId); let C = cd.window.document;
    const rendered = await pollUntil(() => C.querySelectorAll('#fund-document-root .fd-section').length > 0, 30000);
    const cHeads = [...C.querySelectorAll('#fund-document-root .fd-section h2')].map((h) => h.textContent);
    check('★ the real client reads the published document, sections in the enforced order', rendered && cHeads.join('|') === 'Overview|Strategy|Terms & liquidity|Valuation history|Portfolio companies|Governance|Risks|Documents', cHeads.join('|'));
    check('...hero: class, name, unit price, last valued, minimum, horizon', C.querySelector('.fd-class').textContent === 'Private Equity' && C.querySelector('.fd-hero h1').textContent === 'Fund Doc UI Fund ' + suffix && [...C.querySelectorAll('.fd-meta .fd-fig')].map((b) => b.textContent).join('|') === '$132.50|30 Jun 2026|$10,000|5–7 years', [...C.querySelectorAll('.fd-meta .fd-fig')].map((b) => b.textContent).join('|'));
    check('★ ...the injection is literal text, no script element, bold rendered as <strong>', !C.querySelector('#fund-document-root script') && C.querySelector('#fund-document-root .fd-section p').textContent.indexOf(INJECTION) !== -1 && C.querySelector('#fund-document-root .fd-section p strong').textContent === 'Series B and beyond.');
    check('...lists render as real ul/ol', C.querySelectorAll('#fund-document-root .fd-section ul li').length === 2 && C.querySelectorAll('#fund-document-root .fd-section ol li').length === 2);
    const dl = C.querySelector('#fund-document-root .fd-dl-btn');
    check('...the download link is a real signed URL on the project host', !!dl && dl.getAttribute('href').indexOf(url + '/storage/v1/object/sign/fund-documents/' + productId + '/') === 0, dl && dl.getAttribute('href'));
    const dlRes = await fetch(dl.getAttribute('href'));
    check('★ ...and fetching it returns the exact bytes the PM uploaded', dlRes.status === 200 && Buffer.from(await dlRes.arrayBuffer()).equals(fileBytes));
    check('...the disclosure footer is present, verbatim', C.querySelectorAll('.fd-foot p').length === 3 && C.querySelector('.fd-foot p').textContent.indexOf('Private placement investments are NOT bank deposits') === 0);
    check('the page title carries the product name', cd.window.document.title === 'Fund Doc UI Fund ' + suffix + ' — Fund Document — Marketswave');

    // asset-collection: the card link, only for the published product
    const acPath = fileURLToPath(new URL('asset-collection.html', root));
    const acDom = buildPageDom(acPath);
    acDom.window.MarketswaveData = MarketswaveData;
    acDom.window.getAuthenticatedClientId = () => clientId;
    acDom.window.eval(engineCoreSource);
    acDom.window.eval(extractInlineScript(acPath, 'UI Wiring — Stage 2'));
    const A = acDom.window.document;
    await pollUntil(() => A.querySelectorAll('[data-product-id]').length > 0 && !/animate-pulse/.test(A.getElementById('asset-cards-grid').innerHTML), 30000);
    // The seeded catalog (row 202) has more products than one page of nine: page through Load More.
    { const lm = A.getElementById('load-more-btn'); for (let i = 0; i < 12 && lm && !lm.classList.contains('hidden'); i++) { lm.click(); await new Promise((r) => setTimeout(r, 100)); } }
    const cardLink = A.querySelector('[data-product-id="' + productId + '"] .fund-document-link');
    check('★ the product\'s card carries a "Fund document" link to the client page', !!cardLink && cardLink.getAttribute('href') === 'fund-document.html?product=' + productId, cardLink && cardLink.getAttribute('href'));
    check('...a product with no published document shows no link at all', !A.querySelector('[data-product-id="PROD-0002"] .fund-document-link') && !!A.querySelector('[data-product-id="PROD-0002"]'));

    // unpublish (as the PM) -> the client page shows the honest empty state
    const { error: pm2Err } = await adminConfigMod.supabase.auth.signInWithPassword({ email: adminConfigMod.LOCAL_ADMIN_EMAIL, password: adminConfigMod.LOCAL_ADMIN_PASSWORD });
    check('PM signs back in', !pm2Err);
    dom = loadAuthoring(); D = dom.window.document;
    await pollUntil(() => !D.getElementById('doc-form').classList.contains('hidden'), 30000);
    D.getElementById('doc-unpublish-btn').click();
    check('Unpublish opens a confirm modal (never window.confirm)', !D.getElementById('unpublish-modal').classList.contains('hidden'));
    D.getElementById('unpublish-confirm').click();
    const unpub = await pollUntil(() => /Draft · saved/.test(D.getElementById('doc-status-chip').textContent), 30000);
    check('★ confirming unpublishes: chip back to Draft, Unpublish hidden', unpub && D.getElementById('doc-unpublish-btn').classList.contains('hidden'), D.getElementById('doc-status-chip').textContent);
    const { error: c2Err } = await adminConfigMod.supabase.auth.signInWithPassword({ email, password });
    check('client signs back in', !c2Err);
    cd = loadClientPage(productId); C = cd.window.document;
    const emptyShown = await pollUntil(() => !!C.getElementById('fund-document-message-title'), 30000);
    check('★ the client page now shows "No document published", not an empty document', emptyShown && C.getElementById('fund-document-message-title').textContent === 'No document published' && !C.querySelector('.fd-doc'), C.getElementById('fund-document-root').textContent.slice(0, 120));
    cd = loadClientPage('PROD-NOPE'); C = cd.window.document;
    await pollUntil(() => !!C.getElementById('fund-document-message-title'), 30000);
    check('an unknown product id shows the same honest state rather than an error card', C.getElementById('fund-document-message-title') && C.getElementById('fund-document-message-title').textContent === 'No document published');
  } finally {
    const pmMod = await import('../admin-supabase-config.js');
    await pmMod.supabase.auth.signOut().catch(() => {});
    const objs = (await admin.storage.from('fund-documents').list(productId)).data || [];
    for (const o of objs) {
      const inner = (await admin.storage.from('fund-documents').list(productId + '/' + o.name)).data || [];
      await admin.storage.from('fund-documents').remove(inner.map((f) => productId + '/' + o.name + '/' + f.name));
    }
    await admin.from('product_documents').delete().eq('product_id', productId);
    await admin.from('nav_publications').delete().eq('product_id', productId);
    await admin.from('products').delete().eq('id', productId);
    await admin.from('account_state').delete().eq('client_id', clientId);
    await admin.from('clients').delete().eq('id', clientId);
    const { error: delErr } = await admin.auth.admin.deleteUser(clientId);
    if (delErr) console.log('  cleanup: could not delete test user: ' + delErr.message);
    const leftObjs = (await admin.from('products').select('id').eq('id', productId)).data || [];
    if (leftObjs.length) console.log('  cleanup: product still present: ' + productId);
  }

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.');
  if (failed > 0) { console.log('\nVERIFY: FAIL (' + failed + ' assertion(s) failed)'); process.exit(1); }
  console.log('\nVERIFY: PASS');
  process.exit(0);
}
main().catch((err) => { console.error('\nVERIFY FAILED WITH AN ERROR: ' + (err && err.message ? err.message : err)); console.error(err && err.stack); process.exit(1); });
