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
const STAGING_PROJECT_REF = 'ujnmlwbpginplfnofhhv';
const PACE_MS = 1500;          // Finnhub: one symbol per 1.5s
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
async function callFunction(url, token, name, body) {
  let res = await callFunctionOnce(url, token, name, body);
  for (let attempt = 1; attempt <= 3 && isRateLimited(res); attempt++) {
    console.log('        (transient ' + res.status + ' — waiting ' + Math.round(RATE_LIMIT_WAIT_MS / 1000) + 's, retry ' + attempt + '/3)');
    await sleep(RATE_LIMIT_WAIT_MS);
    res = await callFunctionOnce(url, token, name, body);
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

main().then(() => process.exit(0)).catch((err) => { console.error('SEED FAILED: ' + (err && err.stack || err)); process.exit(1); });
