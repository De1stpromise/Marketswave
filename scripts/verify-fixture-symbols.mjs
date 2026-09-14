#!/usr/bin/env node
// verify-fixture-symbols.mjs — every harness fixture that writes to a SHARED, symbol-keyed
// table must use a symbol that provably is not in the real catalog. (2026-09-14, register
// row 215; the class it enforces is row 212.)
//
// ★ RUN THIS BEFORE A TARGETED VERIFICATION PASS, NOT AS PART OF ONE. It takes a few seconds,
//   all of them `supabase status`. The class it catches cost five hours on 2026-09-14: the catalog grew from 5 to 330
//   products and every household-name fixture (AAPL, NVDA, VXUS, LTC, MSFT) silently became a
//   real product. The loud collisions (add-product refused "already offered") surfaced on the
//   first 2h40 pass; the quiet ones — a fake $200 upserted onto AAPL's cache row and synced
//   onto the real product by the next refresh, a teardown removing the real VXUS logo file —
//   never failed an assertion at all and were found by looking at product prices after a
//   second pass. A third pass followed the fix. Run first, this reports all of them at once.
//
// WHAT IT CHECKS (statically, over every verify-*/audit-* source in this directory):
//   - market_data_cache: upsert / insert / delete, and any update that writes a DATA column.
//     An update touching ONLY last_updated / change_percent is metadata — the refresh
//     overwrites it and the suites restore it (row 199's own pattern) — and is not a collision.
//   - products: insert / upsert with a ticker, delete keyed by ticker. (Writes keyed by a
//     PRODUCT ID — PROD-0001 and friends — are deliberate manipulate-and-restore fixtures,
//     row 199, and are out of scope here: they are not symbol-keyed.)
//   - the asset-logos storage bucket: remove / upload of a ticker/<SYM>.* or crypto/<SYM>.*
//     object — a real product's stored mark lives there.
//   - add-product calls: the function refuses an already-offered symbol, so a product symbol
//     here is a guaranteed failure, not a corruption.
// Symbols are read from the write's own position (symbol:, ticker:, .eq('symbol', …),
// .in('symbol', […]), a storage path) as a string literal, an identifier resolved to a
// `const NAME = '…'` / `const NAME = […]` in the same file, or reported as DYNAMIC when it is
// neither (a random suffix cannot collide with a real ticker). Nothing else in a suite is
// read — a per-client row (watchlist_symbols, holdings) is not this class, and a symbol a
// suite merely LOOKS UP is not a write.
//
// THE CATALOG is the union of the live `products.ticker` column (authoritative — a PM can add
// a product from the admin UI at any time) and every symbol in the committed catalog source
// file (so a fresh stack that has not been seeded yet still catches a collision that WILL
// exist the moment it is). `--static` uses the source file alone, for a machine with no stack —
// genuinely weaker: the products that predate the source file (VT, ETH, Cash, the two
// appraisal funds) are not in it, so prefer the live read whenever the stack is up.
//
// WAIVERS, for the two shapes that are deliberate and reported: a comment on the write's own
// line, or within the three lines above it, of the form
//     // fixture-symbols-allow: SPY, BTC — <why this write is deliberate>
// exempts those symbols for that one statement and prints the reason, so a waiver is a
// reviewed decision that lives beside the code, not a silent hole in the check.
//
// CONTROLS — `--self-test` runs the real scanner over temp directories (through the shared
// teardown helper) holding: (A) the two historical suite sources from git that carried the
// row-212 collisions (AAPL at 620bbd3, VXUS + LTC at 8c3bb45) — every one of those must be
// reported by name; (B) the current, fixed sources — nothing reported; (C) a copy of a fixed
// suite with a fresh collision injected (PEPE → BTC) — reported; (D) an empty directory —
// the vacuity guard fails rather than passing. So a run that reports nothing is a run that
// found nothing, not a broken parser. `--dir <path>` scans another directory by hand.

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const argValue = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };
const SCAN_DIR = path.resolve(argValue('--dir') || __dirname);
const STATIC_ONLY = args.includes('--static');
const CATALOG_SOURCE = path.join(__dirname, 'catalog-source-2026-09-14.js');
const SYMBOL_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const METADATA_COLUMNS = new Set(['last_updated', 'change_percent']);
// A dynamic symbol expression that carries a per-run random component cannot collide with a
// real ticker; anything else dynamic (a property, an array built by push(), a loop variable)
// is reported as UNRESOLVED for a human to read, because the row-212 class hides there too:
// the round-robin suite's cleanup deleted 14 real products' cache rows through an array it
// built with push(), which no symbol-level sweep could see.
const RANDOMISED_RE = /suffix|Date\.now|Math\.random|randomUUID|randomBytes/;

// ---- the catalog --------------------------------------------------------------------------
function readLocalStackCredentials() {
  const raw = execSync('supabase status -o json', { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  const status = JSON.parse(raw.slice(raw.indexOf('{')));
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) throw new Error('Refusing to run against a non-local API_URL: ' + status.API_URL);
  return { url: status.API_URL, serviceRoleKey: status.SERVICE_ROLE_KEY };
}
async function loadCatalog() {
  const catalog = new Map(); // UPPER symbol -> { where: 'live'|'source', label }
  let live = 0, source = 0;
  if (!STATIC_ONLY) {
    const { url, serviceRoleKey } = readLocalStackCredentials();
    const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
    const { data, error } = await admin.from('products').select('id, name, ticker').not('ticker', 'is', null);
    if (error) throw new Error('products read failed: ' + error.message);
    for (const p of data) { catalog.set(String(p.ticker).toUpperCase(), { where: 'live', label: p.id + ' ' + p.name }); live++; }
  }
  const src = require(CATALOG_SOURCE);
  for (const section of src.sections || []) {
    for (const item of section.items || []) {
      for (const sym of [item.symbol, item.home]) {
        if (!sym) continue;
        const key = String(sym).toUpperCase();
        if (!catalog.has(key)) { catalog.set(key, { where: 'source', label: 'catalog source: ' + item.name }); source++; }
      }
    }
  }
  return { catalog, live, source };
}

// ---- the scanner --------------------------------------------------------------------------
// From an anchor index, the enclosing statement: forward to the first `;` at bracket depth 0
// relative to the anchor (strings and template literals skipped), capped at 3000 chars.
function statementFrom(text, anchorIdx) {
  let depth = 0, i = anchorIdx, quote = null;
  const end = Math.min(text.length, anchorIdx + 3000);
  for (; i < end; i++) {
    const ch = text[i];
    if (quote) { if (ch === '\\') { i++; continue; } if (ch === quote) quote = null; continue; }
    if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') { depth--; if (depth < 0) break; }
    else if (ch === ';' && depth === 0) break;
  }
  const lineStart = text.lastIndexOf('\n', anchorIdx) + 1;
  return { text: text.slice(lineStart, i), line: text.slice(0, anchorIdx).split('\n').length, lineStart };
}
// The expression at a symbol position: up to the next `,` `}` `)` at depth 0.
function exprAt(s, from) {
  let depth = 0, i = from, quote = null;
  for (; i < s.length; i++) {
    const ch = s[i];
    if (quote) { if (ch === '\\') { i++; continue; } if (ch === quote) quote = null; continue; }
    if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') { if (depth === 0) break; depth--; }
    else if (ch === ',' && depth === 0) break;
  }
  return s.slice(from, i).trim();
}
function splitTopLevel(s) {
  const out = []; let depth = 0, cur = '', quote = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) { cur += ch; if (ch === '\\') { cur += s[++i] || ''; continue; } if (ch === quote) quote = null; continue; }
    if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    if (ch === ')' || ch === ']' || ch === '}') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
// A symbol expression -> { symbols: [UPPER…], dynamic: [expr…] }, resolving identifiers to
// same-file const/let/var initialisers (arrays included), three levels deep at most.
function classify(expr, fileText, depth = 0) {
  const res = { symbols: [], dynamic: [] };
  const e = expr.trim();
  if (!e || e === 'null' || e === 'undefined' || depth > 3) { if (e && e !== 'null' && e !== 'undefined') res.dynamic.push(e); return res; }
  let m;
  if ((m = e.match(/^(['"])([^'"]*)\1$/))) { const v = m[2].toUpperCase(); if (SYMBOL_RE.test(v)) res.symbols.push(v); return res; }
  if (e[0] === '[' && e[e.length - 1] === ']') {
    for (const part of splitTopLevel(e.slice(1, -1))) { const r = classify(part, fileText, depth + 1); res.symbols.push(...r.symbols); res.dynamic.push(...r.dynamic); }
    return res;
  }
  if (/^[A-Za-z_$][\w$]*$/.test(e)) {
    const decl = new RegExp('\\b(?:const|let|var)\\s+' + e.replace(/\$/g, '\\$') + '\\s*=\\s*([^;\\n]+)').exec(fileText);
    if (decl) return classify(decl[1].replace(/\s*\/\/.*$/, ''), fileText, depth + 1);
  }
  res.dynamic.push(e);
  return res;
}
function symbolsAtPositions(stmt, fileText, positions) {
  const found = { symbols: [], dynamic: [] };
  for (const re of positions) {
    let m; const rx = new RegExp(re.source, 'g');
    while ((m = rx.exec(stmt))) {
      const r = classify(exprAt(stmt, m.index + m[0].length), fileText);
      found.symbols.push(...r.symbols); found.dynamic.push(...r.dynamic);
    }
  }
  return found;
}
const CACHE_POSITIONS = [/\bsymbol\s*:\s*/, /\.eq\(\s*['"]symbol['"]\s*,\s*/, /\.in\(\s*['"]symbol['"]\s*,\s*/];
const PRODUCT_POSITIONS = [/\bticker\s*:\s*/, /\.eq\(\s*['"]ticker['"]\s*,\s*/, /\.in\(\s*['"]ticker['"]\s*,\s*/];
const ADD_PRODUCT_POSITIONS = [/\bsymbol\s*:\s*/];

function storageSymbols(stmt, fileText) {
  const found = { symbols: [], dynamic: [] };
  let m;
  const lit = /['"](?:ticker|crypto)\/([A-Za-z0-9.\-]+)\.(?:png|jpg|jpeg|webp|svg|gif)['"]/g;
  while ((m = lit.exec(stmt))) { const v = m[1].toUpperCase(); if (SYMBOL_RE.test(v)) found.symbols.push(v); else found.dynamic.push(m[0]); }
  const cat = /['"](?:ticker|crypto)\/['"]\s*\+\s*([A-Za-z_$][\w$]*)/g;
  while ((m = cat.exec(stmt))) { const r = classify(m[1], fileText); found.symbols.push(...r.symbols); found.dynamic.push(...r.dynamic); }
  return found;
}
function updateIsMetadataOnly(stmt) {
  const m = /\.update\(\s*(\{[\s\S]*?\})\s*\)/.exec(stmt);
  if (!m) return false; // update(someVariable) — payload unknown, treat as a data write
  const keys = []; let k; const rx = /(?:^|[{,]\s*)([A-Za-z_]\w*)\s*:/g;
  while ((k = rx.exec(m[1]))) keys.push(k[1]);
  return keys.length > 0 && keys.every((key) => METADATA_COLUMNS.has(key));
}
function waiversFor(fileText, stmt) {
  const idx = fileText.indexOf(stmt);
  const before = fileText.slice(0, idx).split('\n').slice(-4).join('\n');
  const waived = new Map();
  const rx = /fixture-symbols-allow:\s*([A-Za-z0-9.\-,\s]+?)\s*(?:—|--|-)\s*(.+)/g;
  for (const hay of [before, stmt]) { let m; while ((m = rx.exec(hay))) for (const s of m[1].split(',')) { const v = s.trim().toUpperCase(); if (v) waived.set(v, m[2].trim()); } }
  return waived;
}

const ANCHORS = [
  { kind: 'market_data_cache', re: /\.from\(\s*['"]market_data_cache['"]\s*\)/g, positions: CACHE_POSITIONS, ops: /\.(upsert|insert|delete|update)\(/ },
  { kind: 'products', re: /\.from\(\s*['"]products['"]\s*\)/g, positions: PRODUCT_POSITIONS, ops: /\.(upsert|insert|delete|update)\(/ },
  { kind: 'asset-logos storage', re: /storage\s*\.from\(\s*['"]asset-logos['"]\s*\)/g, positions: null, ops: /\.(remove|upload)\(/ },
  { kind: 'add-product', re: /['"]add-product['"]/g, positions: ADD_PRODUCT_POSITIONS, ops: null }
];

function scanFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  const rel = path.basename(file);
  const out = { statements: 0, writes: [], metadataUpdates: 0, dynamic: 0 };
  for (const a of ANCHORS) {
    let m; const rx = new RegExp(a.re.source, 'g');
    while ((m = rx.exec(text))) {
      const stmt = statementFrom(text, m.index);
      out.statements++;
      let op = null;
      if (a.ops) { const om = a.ops.exec(stmt.text.slice(m.index - stmt.lineStart)); if (!om) continue; op = om[1]; }
      else op = 'call';
      if (a.kind === 'market_data_cache' && op === 'update' && updateIsMetadataOnly(stmt.text)) { out.metadataUpdates++; continue; }
      const found = a.positions ? symbolsAtPositions(stmt.text, text, a.positions) : storageSymbols(stmt.text, text);
      out.dynamic += found.dynamic.length;
      if (!found.symbols.length && !found.dynamic.length) continue;
      const unresolved = found.dynamic.filter((e) => !RANDOMISED_RE.test(e));
      out.writes.push({ file: rel, line: stmt.line, kind: a.kind, op, symbols: [...new Set(found.symbols)], dynamic: found.dynamic, unresolved, waivers: waiversFor(text, stmt.text) });
    }
  }
  return out;
}

// ---- main ---------------------------------------------------------------------------------
async function scan(dir, catalog) {
  const files = fs.readdirSync(dir).filter((f) => /^(verify|audit)-.*\.(m?js)$/.test(f)).map((f) => path.join(dir, f)).sort();
  let statements = 0, metadata = 0, dynamic = 0, resolved = 0;
  const writes = [];
  for (const f of files) { const r = scanFile(f); statements += r.statements; metadata += r.metadataUpdates; dynamic += r.dynamic; writes.push(...r.writes); }
  for (const w of writes) resolved += w.symbols.length;
  const waived = [], collisions = [];
  for (const w of writes) {
    for (const sym of w.symbols) {
      const hit = catalog.get(sym);
      if (!hit) continue;
      if (w.waivers.has(sym)) waived.push({ ...w, sym, hit, reason: w.waivers.get(sym) });
      else collisions.push({ ...w, sym, hit });
    }
  }
  const vacuous = statements === 0 || resolved === 0;
  const unresolved = writes.filter((w) => w.unresolved.length).map((w) => ({ file: w.file, line: w.line, kind: w.kind, op: w.op, exprs: w.unresolved }));
  return { files: files.length, statements, metadata, dynamic, resolved, writes: writes.length, waived, collisions, vacuous, unresolved };
}

function report(r, catalogSize) {
  console.log('  scanned: ' + r.files + ' files, ' + r.statements + ' statements on the four shared surfaces, ' + r.writes + ' writes with a symbol position, ' + r.resolved + ' symbols resolved, ' + r.dynamic + ' dynamic (unresolvable, cannot collide), ' + r.metadata + ' metadata-only cache updates (not a collision)');
  if (r.vacuous) { console.log('\nFIXTURE SYMBOLS: FAIL — nothing was parsed (statements=' + r.statements + ', resolved=' + r.resolved + '); the scanner is broken, this is not an all-clear'); return 1; }
  if (r.unresolved.length) {
    console.log('\nUNRESOLVED — a write whose symbol this scanner cannot read (not randomised: a property, a push()-built array, a loop variable). Not a failure; read each by hand, it is where the class hides from a symbol-level sweep:');
    for (const u of r.unresolved) console.log('  ' + u.file + ':' + u.line + '  ' + u.kind + '.' + u.op + '  ' + u.exprs.join(', '));
  }
  if (r.waived.length) {
    console.log('\nWAIVED (deliberate, reported beside the code):');
    for (const x of r.waived) console.log('  ' + x.file + ':' + x.line + '  ' + x.kind + '.' + x.op + '  ' + x.sym + ' (' + x.hit.label + ') — ' + x.reason);
  }
  if (r.collisions.length) {
    console.log('\nCOLLISIONS — a fixture writes to a symbol the real catalog owns:');
    for (const x of r.collisions) console.log('  FAIL  ' + x.file + ':' + x.line + '  ' + x.kind + '.' + x.op + '  ' + x.sym + ' is ' + x.hit.label + ' [' + x.hit.where + ']');
    console.log('\n  Pick a symbol that provably is not in the catalog (a meme coin for crypto — excluded by policy; for a stock, one absent from products.ticker AND the source file), or, for a write that is deliberate and reported, add on the line above it:');
    console.log('    // fixture-symbols-allow: ' + r.collisions[0].sym + ' — <why>');
    console.log('\nFIXTURE SYMBOLS: FAIL (' + r.collisions.length + ' collision' + (r.collisions.length === 1 ? '' : 's') + ')');
    return 1;
  }
  console.log('\nFIXTURE SYMBOLS: PASS (' + r.resolved + ' fixture symbols checked against ' + catalogSize + ', ' + r.waived.length + ' waived)');
  return 0;
}

async function selfTest(catalog) {
  const { makeTempDir, releaseTempDir } = await import('./lib/harness-teardown.mjs');
  let passed = 0, failed = 0;
  const check = (label, ok, detail) => { if (ok) { passed++; console.log('  PASS  ' + label); } else { failed++; console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); } };
  const hits = (r, file, sym) => r.collisions.filter((c) => c.file === file && c.sym === sym).length;
  const gitShow = (rev, file) => execSync('git show ' + rev + ':scripts/' + file, { cwd: path.join(__dirname, '..'), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });

  console.log('\nSELF-TEST — the scanner against known inputs\n');
  // A. the historical sources that carried the row-212 class, straight from git.
  const a = makeTempDir('mw-fixsym-', { label: 'control-A' });
  try {
    fs.writeFileSync(path.join(a, 'verify-asset-logos-visual.mjs'), gitShow('620bbd3', 'verify-asset-logos-visual.mjs'));
    fs.writeFileSync(path.join(a, 'verify-supabase-asset-logos.js'), gitShow('8c3bb45', 'verify-supabase-asset-logos.js'));
    const r = await scan(a, catalog);
    check('A. 620bbd3 verify-asset-logos-visual: the fake-$200 AAPL upsert is reported', r.collisions.some((c) => c.file === 'verify-asset-logos-visual.mjs' && c.sym === 'AAPL' && c.op === 'upsert'), JSON.stringify(r.collisions.map((c) => c.file + ':' + c.line + ' ' + c.op + ' ' + c.sym)));
    check('A. ...and its AAPL cache delete', r.collisions.some((c) => c.file === 'verify-asset-logos-visual.mjs' && c.sym === 'AAPL' && c.op === 'delete'));
    check('A. 8c3bb45 verify-supabase-asset-logos: add-product VXUS (a guaranteed refusal) is reported', r.collisions.some((c) => c.file === 'verify-supabase-asset-logos.js' && c.sym === 'VXUS' && c.kind === 'add-product'));
    check('A. ...the products delete keyed by ticker VXUS', r.collisions.some((c) => c.file === 'verify-supabase-asset-logos.js' && c.sym === 'VXUS' && c.kind === 'products'));
    check('A. ...the storage remove of the REAL VXUS logo file', r.collisions.some((c) => c.file === 'verify-supabase-asset-logos.js' && c.sym === 'VXUS' && c.kind === 'asset-logos storage'));
    check('A. ...and the LTC writes the row-212 sweep MISSED (an identifier resolved to its const)', hits(r, 'verify-supabase-asset-logos.js', 'LTC') >= 3, String(hits(r, 'verify-supabase-asset-logos.js', 'LTC')));
    check('A. the historical SPY negative-RLS remove is reported too (no waiver existed yet)', hits(r, 'verify-supabase-asset-logos.js', 'SPY') === 1, String(hits(r, 'verify-supabase-asset-logos.js', 'SPY')));
  } finally { await releaseTempDir(a); }
  // B. the current, fixed sources: the same two files, nothing reported.
  const b = makeTempDir('mw-fixsym-', { label: 'control-B' });
  try {
    for (const f of ['verify-asset-logos-visual.mjs', 'verify-supabase-asset-logos.js']) fs.copyFileSync(path.join(__dirname, f), path.join(b, f));
    const r = await scan(b, catalog);
    check('B. the fixed sources: zero collisions (PYPL / VXF / PEPE), the SPY remove waived by name', r.collisions.length === 0 && r.waived.length === 1 && r.waived[0].sym === 'SPY', JSON.stringify(r.collisions.map((c) => c.sym)) + ' waived ' + JSON.stringify(r.waived.map((w) => w.sym)));
    check('B. ...and the scan was not vacuous (' + r.resolved + ' symbols resolved)', !r.vacuous && r.resolved >= 5);
  } finally { await releaseTempDir(b); }
  // C. a fresh collision injected into a fixed suite: PEPE -> BTC (a real product).
  const c = makeTempDir('mw-fixsym-', { label: 'control-C' });
  try {
    const src = fs.readFileSync(path.join(__dirname, 'verify-supabase-asset-logos.js'), 'utf8').replace("const testCoinSymbol = 'PEPE';", "const testCoinSymbol = 'BTC';");
    fs.writeFileSync(path.join(c, 'verify-supabase-asset-logos.js'), src);
    const r = await scan(c, catalog);
    check('C. an injected PEPE -> BTC collision is reported on every write that uses the const (upsert, delete, storage remove)', hits(r, 'verify-supabase-asset-logos.js', 'BTC') >= 4 && r.collisions.some((x) => x.kind === 'asset-logos storage' && x.sym === 'BTC'), String(hits(r, 'verify-supabase-asset-logos.js', 'BTC')));
  } finally { await releaseTempDir(c); }
  // E. a push()-built array is listed as UNRESOLVED, a random-suffix symbol is not.
  const e = makeTempDir('mw-fixsym-', { label: 'control-E' });
  try {
    for (const f of ['verify-round-robin-refresh.mjs', 'verify-asset-logos-visual.mjs']) fs.copyFileSync(path.join(__dirname, f), path.join(e, f));
    const r = await scan(e, catalog);
    check('E. the round-robin cleanup\'s push()-built array (`unowned`, from cleanup.cacheSymbols) is listed UNRESOLVED for review', r.unresolved.some((u) => u.file === 'verify-round-robin-refresh.mjs' && u.kind === 'market_data_cache' && u.op === 'delete'), JSON.stringify(r.unresolved));
    check('E. ...while a random-suffix fixture (brokenSymbol = \'ZZ\' + suffix…) is NOT — it cannot collide', !r.unresolved.some((u) => u.file === 'verify-asset-logos-visual.mjs'), JSON.stringify(r.unresolved.filter((u) => u.file === 'verify-asset-logos-visual.mjs')));
  } finally { await releaseTempDir(e); }
  // D. an empty directory: the vacuity guard, not a pass.
  const d = makeTempDir('mw-fixsym-', { label: 'control-D' });
  try {
    const r = await scan(d, catalog);
    check('D. an empty directory is a FAIL (vacuous), never a PASS', r.vacuous === true);
  } finally { await releaseTempDir(d); }
  console.log('\nSELF-TEST: ' + (failed ? 'FAIL' : 'PASS') + ' (' + passed + '/' + (passed + failed) + ')');
  return failed ? 1 : 0;
}

async function main() {
  console.log('Fixture symbols vs the real catalog (' + (STATIC_ONLY ? 'source file only' : 'live products + source file') + ')\n');
  const { catalog, live, source } = await loadCatalog();
  console.log('  catalog: ' + live + ' live product tickers + ' + source + ' source-file symbols not (yet) live = ' + catalog.size);
  if (catalog.size < 10) { console.log('\nFIXTURE SYMBOLS: FAIL — catalog read returned ' + catalog.size + ' symbols; the read is broken, this is not an all-clear'); process.exitCode = 1; return; }
  if (args.includes('--self-test')) { process.exitCode = await selfTest(catalog); return; }
  process.exitCode = report(await scan(SCAN_DIR, catalog), catalog.size);
}

// process.exitCode, never process.exit(): a hard exit while supabase-js's fetch handles are still
// closing trips libuv's UV_HANDLE_CLOSING assertion on Windows (row 198's known abort) and turns
// a clean 1 into a 127 — for a gate whose whole value is its exit code, the loop must drain.
main().catch((e) => { console.error('FIXTURE SYMBOLS: FAIL — ' + (e.stack || e.message)); process.exitCode = 1; });
