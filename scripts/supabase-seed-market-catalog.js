#!/usr/bin/env node
// ★ Seed the market-priced product catalog THROUGH THE REAL CREATION PATH (2026-09-12).
//
// Every product below is created the way a PM creates one from admin-products.html:
//   1. lookup-product-symbol (pick mode) — the same live price check the PM's search makes,
//      which is also this script's "VERIFY EACH SYMBOL RETURNS A REAL PRICE BEFORE CREATING
//      IT" step: Finnhub answers an unknown symbol with HTTP 200 and {"c":0} (row 195), and a
//      product created against one would sit permanently quote_failed;
//   2. add-product — the real Edge Function, so every row passes the same validation,
//      symbol resolution, asset-class DERIVATION (Finnhub -> Stocks & ETFs, CoinGecko ->
//      Crypto; the request's own class is ignored) and first-price rule a PM's would.
// Never a direct SQL insert.
//
// A symbol that does not price cleanly is DROPPED and reported, never created. A symbol
// already offered by an existing product (products.ticker is unique) is SKIPPED and reported
// — the existing product is left exactly as it is.
//
// WHAT IS SEEDED IS VERIFIABLE FROM THE INSTRUMENT ITSELF: the fund's real name, what it
// holds, and a minimum allocation in this catalog's own existing vocabulary ($1,000 for an
// ETF, $100 for a digital asset — the same figures PROD-0003/PROD-0004 already use). No
// performance claims, ratings or expense figures — nothing a client could read as advice.
//
// Private Equity and Real Assets are deliberately NOT here: they need a real name, strategy
// and valuation that cannot be looked up, so they stay hand-created (publish-nav).
//
// USAGE (from scripts/):
//   node supabase-seed-market-catalog.js              # local stack (pm@marketswave.local)
//   node supabase-seed-market-catalog.js --dry-run    # verify prices only, create nothing
//   node supabase-seed-market-catalog.js --source ./catalog-source-2026-09-14.js [--dry-run]
//                                                     # a curated source file (see below)
//
// ★ --source (2026-09-14, the catalog expansion to ~250): a module exporting
// { sections: [{ key, label, items }], unresolvable: [{ line, reason }] } is seeded section
// by section in the file's own order, with three behaviours the built-in list never needed:
//   - an item with `home` (a home-exchange listing in Finnhub's symbol form) is tried
//     THERE FIRST; if the free tier does not resolve it, the US-listed `symbol` is created
//     instead and the substitution is recorded ON THE PRODUCT (extended description:
//     "US-listed <adrKind>; the <homeExchange> listing <home> is not available on the price
//     feed"), so the record itself says which listing prices it;
//   - an item with `attemptOnly` is priced but never created — it exists so the report can
//     state what the free tier answered for a listing the brief expected to fail;
//   - an item with `bracketNote` is reported as a boundary call on the minimum.
// The final report lists, per section: created / already offered / dropped (with the
// provider's own reason) / resolved natively vs via a US listing / the unresolvable lines
// from the source file / every $500-bracket entry.
//   SUPABASE_STAGING_CREDENTIALS_FILE=<api keys json> \
//   SUPABASE_STAGING_PM_CREDENTIALS_FILE=<the staging PM credentials file> \
//   node supabase-seed-market-catalog.js --staging    # real cloud staging
//
// Rate budget: one Finnhub call per stock symbol for the pick plus one inside add-product
// (its own first-price rule) — ~2 per ETF, paced at one symbol per 1.5s so a full run stays
// well inside the 60/min limit and leaves the interactive reserve alone. CoinGecko's public
// tier is far tighter (its first dry run rate-limited after six picks in nine seconds), so
// coins are paced at 7s and a rate-limit response is waited out and retried, never treated
// as "does not price".

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');

const STAGING = process.argv.indexOf('--staging') !== -1;
const DRY_RUN = process.argv.indexOf('--dry-run') !== -1;
const SOURCE_IDX = process.argv.indexOf('--source');
const SOURCE = SOURCE_IDX !== -1 ? process.argv[SOURCE_IDX + 1] : null;
const STAGING_PROJECT_REF = 'ujnmlwbpginplfnofhhv';
// Pacing is per FINNHUB CALL, not per symbol: a stock pick is a quote + a profile2 lookup,
// add-product's first-price rule is another quote, and a home-listing attempt is one more.
// 1.6s per call is ~37 calls/min — leaving the scheduled refresh its 30 in the minutes it
// runs (every 5 minutes since 2026-09-14) without tripping the 60/min limit. A 429 is still
// waited out and retried below, so a collision costs a minute, never a symbol.
const PACE_PER_CALL_MS = 1600;
const PACE_MS = 1500;          // the built-in list: one ETF symbol per 1.5s (2 calls; unchanged)
const CRYPTO_PACE_MS = 7000;   // CoinGecko's public tier rate-limits far sooner (measured: ~6 picks in 9s tripped it)

// ---- the curated set --------------------------------------------------------------------
// name/holds are the instrument's own facts; minimum/riskTier are catalog choices.
const ETF = (symbol, name, holds, riskTier, minimum) => ({ symbol, source: 'finnhub', providerId: null, name, holds, riskTier, minimum, investmentType: 'ETF' });
const COIN = (symbol, providerId, name, holds) => ({ symbol, source: 'coingecko', providerId, name, holds, riskTier: 'aggressive', minimum: 100, investmentType: 'Digital Asset' });

const CANDIDATES = [
  // Broad equity
  ETF('SPY', 'SPDR S&P 500 ETF Trust', 'Tracks the S&P 500 index: 500 large-cap US companies weighted by market capitalisation.', 'balanced', 1000),
  ETF('QQQ', 'Invesco QQQ Trust', 'Tracks the Nasdaq-100: the 100 largest non-financial companies listed on the Nasdaq.', 'balanced', 1000),
  ETF('DIA', 'SPDR Dow Jones Industrial Average ETF Trust', 'Tracks the Dow Jones Industrial Average: 30 large US companies, price-weighted.', 'balanced', 1000),
  ETF('VT', 'Vanguard Total World Stock ETF', 'Tracks the FTSE Global All Cap index: stocks across developed and emerging markets worldwide.', 'balanced', 1000),
  ETF('VTI', 'Vanguard Total Stock Market ETF', 'Tracks the CRSP US Total Market index: the whole investable US equity market, large to small cap.', 'balanced', 1000),
  ETF('IWM', 'iShares Russell 2000 ETF', 'Tracks the Russell 2000: about 2,000 US small-cap companies.', 'aggressive', 1000),
  // Regional
  ETF('VGK', 'Vanguard FTSE Europe ETF', 'Tracks the FTSE Developed Europe All Cap index: companies in developed European markets.', 'balanced', 1000),
  ETF('EEM', 'iShares MSCI Emerging Markets ETF', 'Tracks the MSCI Emerging Markets index: large and mid-cap companies in emerging economies.', 'aggressive', 1000),
  ETF('EWJ', 'iShares MSCI Japan ETF', 'Tracks the MSCI Japan index: large and mid-cap Japanese companies.', 'balanced', 1000),
  ETF('VPL', 'Vanguard FTSE Pacific ETF', 'Tracks the FTSE Developed Asia Pacific All Cap index: companies in Japan, Australia, Korea, Hong Kong, Singapore and New Zealand.', 'balanced', 1000),
  // Sector
  ETF('XLK', 'Technology Select Sector SPDR Fund', 'Holds the technology-sector companies of the S&P 500.', 'aggressive', 1000),
  ETF('XLF', 'Financial Select Sector SPDR Fund', 'Holds the financial-sector companies of the S&P 500: banks, insurers, capital markets.', 'balanced', 1000),
  ETF('XLE', 'Energy Select Sector SPDR Fund', 'Holds the energy-sector companies of the S&P 500: oil, gas and energy equipment.', 'aggressive', 1000),
  ETF('XLV', 'Health Care Select Sector SPDR Fund', 'Holds the health-care-sector companies of the S&P 500: pharmaceuticals, equipment, providers.', 'balanced', 1000),
  ETF('XLRE', 'Real Estate Select Sector SPDR Fund', 'Holds the real-estate-sector companies of the S&P 500, mainly REITs.', 'balanced', 1000),
  // Fixed income
  ETF('AGG', 'iShares Core U.S. Aggregate Bond ETF', 'Tracks the Bloomberg US Aggregate Bond index: US investment-grade government, corporate and mortgage bonds.', 'conservative', 1000),
  ETF('TLT', 'iShares 20+ Year Treasury Bond ETF', 'Holds US Treasury bonds with more than 20 years to maturity.', 'conservative', 1000),
  ETF('LQD', 'iShares iBoxx $ Investment Grade Corporate Bond ETF', 'Holds US-dollar investment-grade corporate bonds.', 'conservative', 1000),
  // Commodities
  ETF('GLD', 'SPDR Gold Shares', 'Holds physical gold bullion; each share represents a fractional interest in the trust\'s gold.', 'balanced', 1000),
  ETF('SLV', 'iShares Silver Trust', 'Holds physical silver bullion.', 'aggressive', 1000),
  ETF('DBC', 'Invesco DB Commodity Index Tracking Fund', 'Holds futures contracts on a basket of energy, metals and agricultural commodities.', 'aggressive', 1000),
  // Crypto (CoinGecko ids are the instrument's own identifiers)
  COIN('BTC', 'bitcoin', 'Bitcoin', 'The Bitcoin network\'s native asset.'),
  COIN('ETH', 'ethereum', 'Ethereum', 'The Ethereum network\'s native asset, used to pay for computation on the network.'),
  COIN('SOL', 'solana', 'Solana', 'The Solana network\'s native asset.'),
  COIN('ADA', 'cardano', 'Cardano', 'The Cardano network\'s native asset.'),
  COIN('DOT', 'polkadot', 'Polkadot', 'The Polkadot network\'s native asset.'),
  COIN('LINK', 'chainlink', 'Chainlink', 'The token of the Chainlink oracle network.'),
  COIN('AVAX', 'avalanche-2', 'Avalanche', 'The Avalanche network\'s native asset.'),
  COIN('POL', 'polygon-ecosystem-token', 'Polygon (POL)', 'The Polygon network\'s native asset (POL, the successor to MATIC).')
];

// ---- environment ------------------------------------------------------------------------
function stripCliNagBanner(raw) { return raw.slice(raw.indexOf('{')); }

function readLocalStack() {
  const raw = execSync('supabase status -o json', { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  const status = JSON.parse(stripCliNagBanner(raw));
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) throw new Error('Refusing to treat a non-local API_URL as the local stack: ' + status.API_URL);
  return { url: status.API_URL, anonKey: status.ANON_KEY, pmEmail: 'pm@marketswave.local', pmPassword: 'MarketswavePM-Local-2026!' };
}

function readStaging() {
  const keysFile = process.env.SUPABASE_STAGING_CREDENTIALS_FILE;
  const pmFile = process.env.SUPABASE_STAGING_PM_CREDENTIALS_FILE;
  if (!keysFile || !pmFile) throw new Error('--staging needs SUPABASE_STAGING_CREDENTIALS_FILE (the api-keys JSON) and SUPABASE_STAGING_PM_CREDENTIALS_FILE (the staging PM credentials file).');
  const keys = JSON.parse(fs.readFileSync(keysFile, 'utf8'));
  const anon = (Array.isArray(keys) ? keys : []).find((k) => k.name === 'anon');
  if (!anon || !anon.api_key) throw new Error('No anon key entry in ' + keysFile);
  const txt = fs.readFileSync(pmFile, 'utf8');
  const email = /^Email:\s*(.+)$/m.exec(txt), password = /^Password:\s*(.+)$/m.exec(txt);
  if (!email || !password) throw new Error('Could not find Email:/Password: lines in ' + pmFile);
  return { url: 'https://' + STAGING_PROJECT_REF + '.supabase.co', anonKey: anon.api_key, pmEmail: email[1].trim(), pmPassword: password[1].trim() };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callFunctionOnce(url, token, name, body) {
  const r = await fetch(url + '/functions/v1/' + name, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body || {})
  });
  let json = null; try { json = await r.json(); } catch (_e) {}
  return { status: r.status, body: json };
}

// A provider rate limit (503/429) or a gateway hiccup (502/504) is transient, not a verdict
// on the symbol. Wait out the minute and retry before deciding anything; only a genuine
// "no price" (400/404) is a reason to drop.
const RATE_LIMIT_WAIT_MS = 65000;
// ★ The PM's access token lives ONE HOUR, and a full curated run takes longer than that
// (2026-09-14: the first real run signed in once, ran 70 minutes, and the last 30 entries
// were dropped as "You must be signed in" — an auth expiry misread as a pricing failure).
// AUTH holds the live token; a 401 re-signs in once and retries the same call.
const AUTH = { client: null, email: null, password: null, token: null };
async function reauth() {
  const { data, error } = await AUTH.client.auth.signInWithPassword({ email: AUTH.email, password: AUTH.password });
  if (error) throw new Error('PM re-sign-in failed: ' + error.message);
  AUTH.token = data.session.access_token;
  console.log('        (access token expired — signed in again)');
}
async function callFunction(url, token, name, body) {
  token = AUTH.token || token;
  let res = await callFunctionOnce(url, token, name, body);
  if (res.status === 401 && AUTH.client) { await reauth(); res = await callFunctionOnce(url, AUTH.token, name, body); }
  for (let attempt = 1; attempt <= 3 && isRateLimited(res); attempt++) {
    console.log('        (transient ' + res.status + ' — waiting ' + Math.round(RATE_LIMIT_WAIT_MS / 1000) + 's, retry ' + attempt + '/3)');
    await sleep(RATE_LIMIT_WAIT_MS);
    res = await callFunctionOnce(url, AUTH.token || token, name, body);
  }
  return res;
}
function isRateLimited(res) {
  // 502/504 are the gateway, not the symbol: the first real staging run dropped ETH on a
  // bare HTTP 502 and reported it as "did not price cleanly", which it never was.
  return res.status === 503 || res.status === 502 || res.status === 504 || res.status === 429 || /rate-limit/i.test((res.body && res.body.error) || '');
}

async function main() {
  const env = STAGING ? readStaging() : readLocalStack();
  console.log((STAGING ? 'REAL CLOUD STAGING' : 'local stack') + ' — ' + env.url + (DRY_RUN ? '  (DRY RUN: verify prices only)' : ''));

  const client = createClient(env.url, env.anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: session, error: signInErr } = await client.auth.signInWithPassword({ email: env.pmEmail, password: env.pmPassword });
  if (signInErr) throw new Error('PM sign-in failed: ' + signInErr.message);
  const token = session.session.access_token;
  Object.assign(AUTH, { client, email: env.pmEmail, password: env.pmPassword, token });

  if (SOURCE) return seedFromSource(env, token);

  const created = [], skipped = [], dropped = [];
  for (const c of CANDIDATES) {
    // 1. verify it prices — the PM's own pick step.
    const pick = await callFunction(env.url, token, 'lookup-product-symbol', { symbol: c.symbol, source: c.source, providerId: c.providerId, name: c.name });
    if (pick.status !== 200 || !(Number(pick.body && pick.body.price) > 0)) {
      dropped.push({ symbol: c.symbol, reason: (pick.body && pick.body.error) || ('HTTP ' + pick.status) });
      console.log('  DROP  ' + c.symbol.padEnd(5) + ' ' + ((pick.body && pick.body.error) || ('HTTP ' + pick.status)));
      await sleep(c.source === 'coingecko' ? CRYPTO_PACE_MS : PACE_MS); continue;
    }
    if (pick.body.alreadyOffered) {
      skipped.push({ symbol: c.symbol, reason: 'already offered by an existing product' });
      console.log('  SKIP  ' + c.symbol.padEnd(5) + ' already offered — existing product left as is (live ' + pick.body.price + ')');
      await sleep(c.source === 'coingecko' ? CRYPTO_PACE_MS : PACE_MS); continue;
    }
    if (DRY_RUN) {
      console.log('  OK    ' + c.symbol.padEnd(5) + ' prices at ' + pick.body.price + ' -> would create "' + c.name + '" (' + pick.body.assetClass + ')');
      await sleep(c.source === 'coingecko' ? CRYPTO_PACE_MS : PACE_MS); continue;
    }
    // 2. create it through the real path.
    const res = await callFunction(env.url, token, 'add-product', {
      pricingModel: 'market', source: c.source, symbol: c.symbol, providerId: c.providerId,
      name: c.name, investmentType: c.investmentType, riskTier: c.riskTier, minimumInvestment: c.minimum,
      description: c.holds
    });
    if (res.status !== 200) {
      dropped.push({ symbol: c.symbol, reason: (res.body && res.body.error) || ('HTTP ' + res.status) });
      console.log('  DROP  ' + c.symbol.padEnd(5) + ' add-product refused: ' + ((res.body && res.body.error) || ('HTTP ' + res.status)));
    } else {
      created.push({ id: res.body.id, symbol: c.symbol, name: res.body.name, assetClass: res.body.assetClass, unitPrice: res.body.unitPrice });
      console.log('  ADD   ' + c.symbol.padEnd(5) + ' ' + res.body.id + '  ' + res.body.name + '  [' + res.body.assetClass + ']  ' + res.body.unitPrice);
    }
    await sleep(c.source === 'coingecko' ? CRYPTO_PACE_MS : PACE_MS);
  }

  console.log('\n' + created.length + ' created, ' + skipped.length + ' skipped (already offered), ' + dropped.length + ' dropped (did not price cleanly).');
  if (skipped.length) console.log('skipped: ' + skipped.map((s) => s.symbol).join(', '));
  if (dropped.length) console.log('dropped: ' + dropped.map((d) => d.symbol + ' (' + d.reason + ')').join('; '));
  return { created, skipped, dropped };
}

// ---- --source: a curated file, section by section --------------------------------------
async function seedFromSource(env, token) {
  const src = require(path.resolve(SOURCE));
  const report = { created: [], skipped: [], dropped: [], native: [], substituted: [], attemptOnly: [], bracket500: [], bracketNotes: [] };
  const paceFor = (c, calls) => sleep(c.source === 'coingecko' ? CRYPTO_PACE_MS : calls * PACE_PER_CALL_MS);

  for (const section of src.sections) {
    console.log('\n== ' + section.label + ' (' + section.items.length + ')');
    for (let c of section.items) {
      let calls = 0;
      // 1a. the home-exchange listing first, where the entry names one.
      let homeResult = null;
      if (c.home) {
        const hp = await callFunction(env.url, token, 'lookup-product-symbol', { symbol: c.home, source: 'finnhub', providerId: null, name: c.name });
        calls += 2;
        homeResult = hp.status === 200 && Number(hp.body && hp.body.price) > 0 ? 'priced' : ((hp.body && hp.body.error) || ('HTTP ' + hp.status));
        if (homeResult === 'priced') {
          // The home listing prices on the feed — create THAT, no substitution needed.
          report.native.push({ symbol: c.home, name: c.name });
          console.log('  HOME  ' + c.home.padEnd(10) + ' the home listing prices natively (' + hp.body.price + ') — created as the home listing');
          c = Object.assign({}, c, { symbol: c.home, substitution: null });
        } else {
          console.log('  home  ' + c.home.padEnd(10) + ' not on the feed: ' + homeResult + ' — trying the US listing ' + c.symbol);
          c = Object.assign({}, c, { substitution: 'US-listed ' + c.adrKind + '; the ' + c.homeExchange + ' listing (' + c.home + ') is not available on the price feed.' });
        }
      }
      // 1b. the pick — the PM's own verify-it-prices step.
      const pick = await callFunction(env.url, token, 'lookup-product-symbol', { symbol: c.symbol, source: c.source, providerId: c.providerId, name: c.name });
      calls += c.source === 'finnhub' ? 2 : 1;
      if (pick.status !== 200 || !(Number(pick.body && pick.body.price) > 0)) {
        const reason = (pick.body && pick.body.error) || ('HTTP ' + pick.status);
        if (c.attemptOnly) { report.attemptOnly.push({ symbol: c.symbol, name: c.name, result: reason }); console.log('  ATTEMPT ' + c.symbol.padEnd(8) + ' ' + reason); }
        else { report.dropped.push({ symbol: c.symbol, name: c.name, section: section.key, reason }); console.log('  DROP  ' + c.symbol.padEnd(8) + ' ' + reason); }
        await paceFor(c, calls); continue;
      }
      if (c.attemptOnly) {
        report.attemptOnly.push({ symbol: c.symbol, name: c.name, result: 'PRICED at ' + pick.body.price + ' (not created: attempt-only entry)' });
        console.log('  ATTEMPT ' + c.symbol.padEnd(8) + ' unexpectedly prices at ' + pick.body.price + ' — not created (attempt-only), reported');
        await paceFor(c, calls); continue;
      }
      if (c.substitution) report.substituted.push({ symbol: c.symbol, home: c.home, name: c.name, adrKind: c.adrKind });
      else if (c.home === undefined && section.key.startsWith('c-')) report.native.push({ symbol: c.symbol, name: c.name });
      if (c.minimum === 500) report.bracket500.push({ symbol: c.symbol, name: c.name, section: section.key });
      if (c.bracketNote) report.bracketNotes.push({ symbol: c.symbol, note: c.bracketNote });
      if (pick.body.alreadyOffered) {
        report.skipped.push({ symbol: c.symbol, name: c.name, section: section.key });
        console.log('  SKIP  ' + c.symbol.padEnd(8) + ' already offered — existing product left as is (live ' + pick.body.price + ')');
        await paceFor(c, calls); continue;
      }
      if (DRY_RUN) {
        console.log('  OK    ' + c.symbol.padEnd(8) + ' prices at ' + String(pick.body.price).padEnd(10) + ' -> would create "' + c.name + '" (' + pick.body.assetClass + ', min $' + c.minimum + (c.substitution ? ', US listing' : '') + ')');
        await paceFor(c, calls); continue;
      }
      // 2. create it through the real path.
      const body = {
        pricingModel: 'market', source: c.source, symbol: c.symbol, providerId: c.providerId,
        name: c.name, investmentType: c.investmentType, riskTier: c.riskTier, minimumInvestment: c.minimum,
        description: c.holds
      };
      if (c.substitution) body.extendedDescription = c.substitution;
      const res = await callFunction(env.url, token, 'add-product', body);
      calls += c.source === 'finnhub' ? 1 : 0;
      if (res.status !== 200) {
        const reason = (res.body && res.body.error) || ('HTTP ' + res.status);
        report.dropped.push({ symbol: c.symbol, name: c.name, section: section.key, reason: 'add-product refused: ' + reason });
        console.log('  DROP  ' + c.symbol.padEnd(8) + ' add-product refused: ' + reason);
      } else {
        report.created.push({ id: res.body.id, symbol: c.symbol, name: res.body.name, assetClass: res.body.assetClass, unitPrice: res.body.unitPrice, section: section.key, logo: !!res.body.logoUrl });
        console.log('  ADD   ' + c.symbol.padEnd(8) + ' ' + res.body.id + '  ' + res.body.name + '  [' + res.body.assetClass + ']  ' + res.body.unitPrice + (res.body.logoUrl ? '  logo' : '  monogram'));
      }
      await paceFor(c, calls);
    }
  }

  // ---- the report -------------------------------------------------------------------
  const by = (arr, key) => arr.reduce((m, x) => { (m[x[key]] = m[x[key]] || []).push(x); return m; }, {});
  console.log('\n==================== SEED REPORT (' + (DRY_RUN ? 'DRY RUN' : 'REAL') + ') ====================');
  console.log(report.created.length + ' created, ' + report.skipped.length + ' already offered (skipped), ' + report.dropped.length + ' dropped.');
  const cs = by(report.created, 'section'); Object.keys(cs).forEach((k) => console.log('  created in ' + k + ': ' + cs[k].length + ' (' + cs[k].filter((x) => x.logo).length + ' with a resolved logo at creation)'));
  if (report.skipped.length) console.log('already offered: ' + report.skipped.map((x) => x.symbol).join(', '));
  if (report.dropped.length) { console.log('DROPPED (did not price cleanly):'); report.dropped.forEach((d) => console.log('  ' + d.symbol.padEnd(8) + ' ' + d.name + ' — ' + d.reason)); }
  console.log('\nEUROPEAN LISTINGS — resolved natively (home exchange): ' + (report.native.length ? report.native.map((x) => x.symbol).join(', ') : 'none'));
  console.log('EUROPEAN LISTINGS — via a US listing (substitution recorded on the product): ' + report.substituted.length);
  report.substituted.forEach((x) => console.log('  ' + x.symbol.padEnd(8) + ' for ' + x.home.padEnd(11) + ' ' + x.adrKind.padEnd(22) + ' ' + x.name));
  if (report.attemptOnly.length) { console.log('\nATTEMPT-ONLY LISTINGS (never created; what the feed answered):'); report.attemptOnly.forEach((x) => console.log('  ' + x.symbol.padEnd(10) + ' ' + x.name + ' — ' + x.result)); }
  console.log('\n$500 BRACKET (' + report.bracket500.length + '): ' + report.bracket500.map((x) => x.symbol).join(', '));
  if (report.bracketNotes.length) { console.log('BOUNDARY CALLS:'); report.bracketNotes.forEach((x) => console.log('  ' + x.symbol.padEnd(8) + ' ' + x.note)); }
  console.log('\nUNRESOLVABLE / SKIPPED SOURCE LINES (' + src.unresolvable.length + '):');
  src.unresolvable.forEach((u) => console.log('  ' + u.line + ' — ' + u.reason));
  return report;
}

main().then(() => process.exit(0)).catch((err) => { console.error('SEED FAILED: ' + (err && err.stack || err)); process.exit(1); });
