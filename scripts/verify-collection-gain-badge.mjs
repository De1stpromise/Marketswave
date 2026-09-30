#!/usr/bin/env node
// ★ The Asset Collection's gain badge comes from the server (2026-09-30, register row 291).
//
// asset-collection.html computed a held product's unrealised % in the browser — the last place
// money was calculated client-side. It now renders get-returns-summary's per-position
// `unrealized` / `unrealizedPercent`, formatted with Asset & performance's own rules.
//
// PROOF, for EVERY holding, with the REAL scripts of BOTH pages running under one real client
// session: (1) the badge's percentage text is IDENTICAL to that holding's percentage on Asset &
// performance; (2) the badge's unrealised amount (carried on the badge as data-unrealized) equals
// get-returns-summary's to the cent, and rounds to exactly the whole-dollar figure Asset &
// performance shows (that page displays whole dollars, so "to the cent" is proven on the value
// behind the display). Holdings are deliberately a gain, a loss and an EXACTLY-ZERO position on
// simulated products (a price that is a pure function of id and date — nothing moves mid-run).
//
// Forced-failure control: MW_BADGE_CONTROL=old runs asset-collection.html as it was at 1e6533a
// (the browser computation) through the same comparisons; the zero position renders "0.0%"
// against Asset & performance's "+0.0%", and that holding must fail by name.
import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { runVerifyMain } from './lib/run-verify.mjs';
import { createSimulatedTestProduct, deleteSimulatedTestProduct } from './lib/simulated-test-product.mjs';

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
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CONTROL = process.env.MW_BADGE_CONTROL === 'old';
function pageSource(file) {
  if (CONTROL && file === 'asset-collection.html') return execSync('git show 1e6533a:asset-collection.html', { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return readFileSync(ROOT + file, 'utf8');
}
function pageDom(file) {
  const html = pageSource(file);
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '');
  const dom = new JSDOM('<!doctype html><html><body>' + body + '</body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.indexOf('UI Wiring — Stage 2') !== -1);
  if (!script) throw new Error('no page script in ' + file);
  return { dom, script };
}

async function main() {
  console.log('The Asset Collection gain badge, from the server' + (CONTROL ? ' — FORCED-FAILURE CONTROL (the 1e6533a browser computation)' : '') + '\n');
  const raw = execSync('supabase status -o json', { cwd: ROOT, encoding: 'utf8' });
  const st = JSON.parse(raw.slice(raw.indexOf('{')));
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(st.API_URL)) throw new Error('Refusing to run against a non-local API_URL');
  const admin = createClient(st.API_URL, st.SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(4).toString('hex');
  const email = 'gainbadge-' + suffix + '@test.marketswave.local', password = 'GainBadge-2026!' + suffix;
  const products = [];
  let userId = null;
  try {
    // Three simulated products at 103.16 (the helper's price). Positions: a gain, a loss, zero.
    for (const tag of ['gain', 'loss', 'zero']) products.push(await createSimulatedTestProduct(admin, suffix + tag, { name: 'Gain Badge ' + tag + ' ' + suffix }));
    const { data: u, error: ue } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (ue) throw new Error(ue.message);
    userId = u.user.id;
    await admin.from('clients').insert({ id: userId, name: 'Gain Badge Fixture ' + suffix, email: 'gainbadge-malformed-' + suffix, phone: '+46 70 000 0000', account_type: 'Individual Account', status: 'active' });
    await admin.from('account_state').insert({ client_id: userId, unallocated_capital: 1000, allocated_capital: 0, asset_returns: 0 });
    const price = Number(products[0].unit_price);
    await admin.from('holdings').insert([
      { client_id: userId, product_id: products[0].id, units: 12.3456, cost_basis: 1100.37 },   // gain
      { client_id: userId, product_id: products[1].id, units: 7.891, cost_basis: 911.23 },      // loss
      { client_id: userId, product_id: products[2].id, units: 10, cost_basis: Math.round(10 * price * 100) / 100 } // exactly zero
    ]);

    globalThis.window = { location: { hostname: '127.0.0.1', search: '' } };
    await import('../supabase-data.js');
    const MD = globalThis.window.MarketswaveData;
    const supa = await MD.getSupabaseClient();
    const { data: sess, error: se } = await supa.auth.signInWithPassword({ email, password });
    check('the fixture client signs in', !se, se && se.message);

    // The server's own figures, read independently of either page.
    const r = await fetch(st.API_URL + '/functions/v1/get-returns-summary', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + sess.session.access_token }, body: '{}' });
    const summary = await r.json();
    const server = {};
    (summary.positions || []).forEach((p) => { server[p.productId] = p; });
    check('get-returns-summary returns all three positions', products.every((p) => server[p.id]), JSON.stringify(Object.keys(server)));
    check('NON-VACUITY: the three positions really are a gain, a loss and exactly zero',
      server[products[0].id].unrealized > 0 && server[products[1].id].unrealized < 0 && server[products[2].id].unrealized === 0,
      JSON.stringify(products.map((p) => server[p.id] && server[p.id].unrealized)));

    // Asset & performance, real script.
    const ap = pageDom('asset-performance.html');
    ap.dom.window.MarketswaveData = MD;
    ap.dom.window.eval(readFileSync(ROOT + 'asset-mark.js', 'utf8'));
    ap.dom.window.eval(ap.script);
    const apDoc = ap.dom.window.document;
    await pollUntil(() => products.every((p) => apDoc.querySelector('#return-table-body [data-product-id="' + p.id + '"]')), 30000);

    // The Asset Collection, real script, "Held first" so every holding is on the first page.
    const ac = pageDom('asset-collection.html');
    ac.dom.window.MarketswaveData = MD;
    ac.dom.window.getClientInitials = function (n) { return n.slice(0, 2).toUpperCase(); };
    ac.dom.window.eval(readFileSync(ROOT + 'asset-mark.js', 'utf8'));
    ac.dom.window.eval(ac.script);
    const acDoc = ac.dom.window.document;
    await pollUntil(() => acDoc.querySelector('.cat-card[data-held="1"]'), 30000);
    const sortSel = acDoc.getElementById('catalog-sort');
    sortSel.value = 'held-first'; sortSel.dispatchEvent(new ac.dom.window.Event('change', { bubbles: true }));
    await pollUntil(() => products.every((p) => acDoc.querySelector('.cat-card[data-product-id="' + p.id + '"] .cat-g')), 15000);

    for (const [i, p] of products.entries()) {
      const tag = ['gain', 'loss', 'zero'][i];
      const badge = acDoc.querySelector('.cat-card[data-product-id="' + p.id + '"] .cat-g');
      const row = apDoc.querySelector('#return-table-body [data-product-id="' + p.id + '"]').closest('tr');
      const apPct = row.querySelector('.rt-gain .p').textContent.trim();
      const apAmt = row.querySelector('.rt-gain .a').textContent.trim();
      const apDollars = (apAmt.startsWith('−') ? -1 : 1) * Number(apAmt.replace(/[^0-9.]/g, ''));
      const badgePct = badge ? badge.textContent.trim() : null;
      check('★ ' + tag + ': the badge percentage is IDENTICAL to Asset & performance (' + apPct + ')', badgePct === apPct, 'badge=' + badgePct + ' asset&perf=' + apPct);
      const cents = badge && badge.getAttribute('data-unrealized') != null ? Number(badge.getAttribute('data-unrealized')) : NaN;
      check('★ ' + tag + ': the badge amount equals get-returns-summary to the cent (' + server[p.id].unrealized + ')', cents === server[p.id].unrealized, 'badge=' + cents);
      check(tag + ': ...and rounds to exactly the dollars Asset & performance shows (' + apAmt + ')', Math.round(cents) === apDollars, 'badge=' + cents + ' asset&perf=' + apAmt);
      const badgeDir = badge && (badge.classList.contains('up') ? 1 : badge.classList.contains('dn') ? -1 : 0);
      const apDir = row.querySelector('.rt-gain .a').classList.contains('rt-pos') ? 1 : row.querySelector('.rt-gain .a').classList.contains('rt-neg') ? -1 : 0;
      check(tag + ': the tone matches too (gain / loss / flat)', badgeDir === apDir, 'badge=' + badgeDir + ' asset&perf=' + apDir);
    }
    const src = pageSource('asset-collection.html');
    check('no browser computation of unrealised money remains in the page', !/function getUnrealizedReturnPercent\s*\(/.test(src) && !/\.units\s*\*\s*\w+\.unitPrice\s*-\s*\w+\.costBasis/.test(src));
  } finally {
    if (userId) { const { error } = await admin.auth.admin.deleteUser(userId); if (error) console.log('  cleanup: ' + error.message); }
    for (const p of products) await deleteSimulatedTestProduct(admin, p.id);
  }
  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.');
  console.log('\nGAIN BADGE: ' + (failed ? 'FAIL' : 'PASS'));
  if (failed) throw new Error(failed + ' assertion(s) failed');
}
runVerifyMain(main);
