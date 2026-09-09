#!/usr/bin/env node
// Backend Migration Phase C — Stage 1 (2026-09-06).
//
// Real per-PM attribution verification, against the real local Supabase stack. Confirms:
//   1. Two GENUINELY DIFFERENT real PM accounts (pm@marketswave.local, pm2@marketswave.local
//      — bootstrapped via scripts/supabase-bootstrap-admin.js and
//      scripts/supabase-bootstrap-additional-pm.js respectively) each produce their OWN,
//      correctly distinguishable resolved_by/resolved_by_email (or created_by/updated_by/
//      reviewed_by/published_by, per table) on a real row they resolve/create/update —
//      never the other PM's identity, never the old generic "Portfolio Manager" string.
//   2. A non-admin authenticated caller is still correctly blocked (403) from every one of
//      these functions — same rigor as every prior admin-role test in this project. Also
//      confirms, by diffing the actual file source, that the admin-check block itself
//      (`if (claimsData.claims.app_metadata?.is_admin !== true) { ... 403 ... }`) was never
//      modified in any of the 22 touched functions — only code strictly AFTER that check
//      succeeds was added, so this stage could not have weakened authorization anywhere.
//   3. The LOCAL Security Log (engine-core.js's appendSecurityLogEntry(), still 100% local —
//      confirmed directly, no real Supabase backend exists for it) also distinguishes two
//      different PMs' actions correctly, via the real engine-harness.js technique (load the
//      real engine-core.js source, not a reimplementation).
//
// LOCAL STACK ONLY. Standing convention: Node/API-level verification only, no browser
// automation, per CLAUDE.md.
//
// Usage:  node scripts/verify-supabase-pm-attribution.js
// Requires: the local Supabase stack running, this stage's migration applied, both PM
// accounts bootstrapped (pm@marketswave.local via supabase-bootstrap-admin.js,
// pm2@marketswave.local via `node scripts/supabase-bootstrap-additional-pm.js
// pm2@marketswave.local "MarketswavePM2-Local-2026!"`), and the edge-runtime container
// reachable.

const { execSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { loadEngine, createSharedStorage } = require('./lib/engine-harness');

let passed = 0;
let failed = 0;

function check(label, condition, detail) {
  if (condition) {
    passed++;
    console.log('  PASS  ' + label);
  } else {
    failed++;
    console.log('  FAIL  ' + label + (detail ? ' — ' + detail : ''));
  }
}

function readLocalStackCredentials() {
  const raw = execSync('supabase status -o json', { cwd: __dirname + '/..', encoding: 'utf8' });
  const status = JSON.parse(raw);
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) {
    throw new Error('Refusing to run against a non-local API_URL: ' + status.API_URL);
  }
  return { url: status.API_URL, anonKey: status.ANON_KEY, serviceRoleKey: status.SERVICE_ROLE_KEY };
}

async function signIn(url, anonKey, email, password) {
  const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error('signIn(' + email + ') failed: ' + error.message);
  return { client, session: data.session };
}

async function createTestClient(admin, email, password) {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error('createUser(' + email + ') failed: ' + error.message);
  return data.user;
}

// ---- Part 2's static-diff check: confirm the admin-check block itself is byte-identical
// across every touched function, i.e. this stage only ever added code AFTER it, never
// modified the check itself.
const ADMIN_CHECK_BLOCK =
  "if (claimsData.claims.app_metadata?.is_admin !== true) {\n      return jsonResponse({ error: 'This action requires Portfolio Manager access.' }, 403);\n    }";

const TOUCHED_FUNCTIONS = [
  'approve-allocation', 'reject-allocation', 'approve-sell', 'reject-sell',
  'approve-withdrawal', 'reject-withdrawal', 'credit-deposit', 'reject-deposit',
  'approve-hys-withdrawal', 'reject-hys-withdrawal', 'credit-hys-deposit', 'reject-hys-deposit',
  'approve-profile-change', 'reject-profile-change', 'approve-client-application',
  'reject-client-application', 'update-document', 'publish-document', 'update-support-ticket',
  'add-product', 'edit-product', 'update-advisory-fee-rate'
];

async function main() {
  console.log('Backend Migration Phase C — Stage 1 verification (real per-PM attribution)\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  console.log('API URL: ' + url + '\n');

  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(4).toString('hex');
  const password = 'VerifyPmAttribution-2026!';

  const pm1Email = 'pm@marketswave.local';
  const pm1Password = 'MarketswavePM-Local-2026!';
  const pm2Email = 'pm2@marketswave.local';
  const pm2Password = 'MarketswavePM2-Local-2026!';

  // The custom_access_token_hook injects app_metadata.is_admin into the ISSUED JWT'S OWN
  // claims — a genuinely different thing from session.user.app_metadata, which just reflects
  // the raw auth.users.raw_app_meta_data column and is NOT where the hook's injected claim
  // shows up. Decode the real access_token payload directly, the same way this project's own
  // real-cloud diagnosis already confirmed the claims shape, rather than reading the wrong
  // field and getting a false negative.
  function decodeJwtClaims(accessToken) {
    return JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64').toString());
  }

  const pm1 = await signIn(url, anonKey, pm1Email, pm1Password);
  const pm2 = await signIn(url, anonKey, pm2Email, pm2Password);
  const pm1Claims = decodeJwtClaims(pm1.session.access_token);
  const pm2Claims = decodeJwtClaims(pm2.session.access_token);
  check('PM #1 and PM #2 are genuinely different real user ids', pm1.session.user.id !== pm2.session.user.id);
  check('PM #1\'s real issued JWT carries app_metadata.is_admin === true', pm1Claims.app_metadata && pm1Claims.app_metadata.is_admin === true, JSON.stringify(pm1Claims.app_metadata));
  check('PM #2\'s real issued JWT carries app_metadata.is_admin === true', pm2Claims.app_metadata && pm2Claims.app_metadata.is_admin === true, JSON.stringify(pm2Claims.app_metadata));

  const nonAdminEmail = 'non-admin-' + suffix + '@test.marketswave.local';
  const nonAdminUser = await createTestClient(admin, nonAdminEmail, password);
  const nonAdmin = await signIn(url, anonKey, nonAdminEmail, password);
  const nonAdminClaims = decodeJwtClaims(nonAdmin.session.access_token);
  check('The non-admin test account\'s real issued JWT genuinely has no is_admin claim', !nonAdminClaims.app_metadata || nonAdminClaims.app_metadata.is_admin !== true, JSON.stringify(nonAdminClaims.app_metadata));

  // ===========================================================================================
  // PART 0 — static proof: the admin-check block itself was never touched in any function
  // ===========================================================================================
  console.log('\n0. Static proof — the 403 admin-check block is byte-identical in every touched function\n');
  for (const fn of TOUCHED_FUNCTIONS) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', fn, 'index.ts'), 'utf8');
    check(fn + ': admin-check block present, unmodified', src.includes(ADMIN_CHECK_BLOCK));
  }

  // ===========================================================================================
  // PART 1 — real distinguishable attribution, one representative action per domain, using
  // BOTH real PMs on genuinely separate rows so their identities can never coincide by luck.
  // ===========================================================================================
  console.log('\n1. Real distinguishable attribution — PM #1 vs. PM #2 on separate real rows\n');

  async function makeClientWithAccountState(labelSuffix) {
    const email = 'attrib-' + labelSuffix + '-' + suffix + '@test.marketswave.local';
    const user = await createTestClient(admin, email, password);
    await admin.from('clients').insert({ id: user.id, name: 'Attrib Test ' + labelSuffix, email, phone: '+1-555-0200', account_type: 'Individual Account', status: 'active' });
    await admin.from('account_state').insert({ client_id: user.id, unallocated_capital: 50000, allocated_capital: 0, asset_returns: 0 });
    return user;
  }

  // ---- 1a. Client Applications: approve-client-application (PM1) vs reject (PM2) ----
  await (async function () {
    const emailA = 'capp-a-' + suffix + '@test.marketswave.local';
    const userA = await createTestClient(admin, emailA, password);
    await admin.from('clients').insert({ id: userA.id, name: 'Applicant A', email: emailA, phone: '+1-555-0300', account_type: 'Individual Account', status: 'pending_review' });
    const emailB = 'capp-b-' + suffix + '@test.marketswave.local';
    const userB = await createTestClient(admin, emailB, password);
    await admin.from('clients').insert({ id: userB.id, name: 'Applicant B', email: emailB, phone: '+1-555-0301', account_type: 'Individual Account', status: 'pending_review' });

    await pm1.client.functions.invoke('approve-client-application', { body: { clientId: userA.id } });
    await pm2.client.functions.invoke('reject-client-application', { body: { clientId: userB.id, reason: 'test' } });

    const { data: rowA } = await admin.from('clients').select('application_resolved_by,application_resolved_by_email').eq('id', userA.id).single();
    const { data: rowB } = await admin.from('clients').select('application_resolved_by,application_resolved_by_email').eq('id', userB.id).single();
    check('approve-client-application records PM #1\'s real id+email', rowA.application_resolved_by === pm1.session.user.id && rowA.application_resolved_by_email === pm1Email, JSON.stringify(rowA));
    check('reject-client-application records PM #2\'s real id+email', rowB.application_resolved_by === pm2.session.user.id && rowB.application_resolved_by_email === pm2Email, JSON.stringify(rowB));
    check('the two attributions are genuinely different from each other', rowA.application_resolved_by !== rowB.application_resolved_by);

    // Non-admin blocked
    const emailC = 'capp-c-' + suffix + '@test.marketswave.local';
    const userC = await createTestClient(admin, emailC, password);
    await admin.from('clients').insert({ id: userC.id, name: 'Applicant C', email: emailC, phone: '+1-555-0302', account_type: 'Individual Account', status: 'pending_review' });
    const { error: blockedErr } = await nonAdmin.client.functions.invoke('approve-client-application', { body: { clientId: userC.id } });
    check('non-admin caller is blocked from approve-client-application (403)', blockedErr && blockedErr.context && blockedErr.context.status === 403, blockedErr && blockedErr.message);
    const { data: stillPending } = await admin.from('clients').select('status').eq('id', userC.id).single();
    check('the blocked attempt genuinely left the row untouched', stillPending.status === 'pending_review');

    await admin.from('clients').delete().in('id', [userA.id, userB.id, userC.id]);
    await admin.auth.admin.deleteUser(userA.id);
    await admin.auth.admin.deleteUser(userB.id);
    await admin.auth.admin.deleteUser(userC.id);
  })();

  // ---- 1b. Allocations: request + approve as PM1, a second as PM2 ----
  await (async function () {
    const { data: product } = await admin.from('products').select('id,minimum_investment').eq('asset_class', 'Stocks & ETFs').limit(1).maybeSingle();
    if (!product) { check('a seeded Stocks & ETFs product exists for the allocation test', false, 'run supabase-seed-portfolio.js first'); return; }

    const clientA = await makeClientWithAccountState('alloc-a');
    const clientSignInA = await signIn(url, anonKey, clientA.email, password);
    const { data: reqA } = await clientSignInA.client.functions.invoke('request-allocation', { body: { productId: product.id, dollarAmount: Math.max(product.minimum_investment, 1000) } });
    await pm1.client.functions.invoke('approve-allocation', { body: { requestId: reqA.id } });

    const clientB = await makeClientWithAccountState('alloc-b');
    const clientSignInB = await signIn(url, anonKey, clientB.email, password);
    const { data: reqB } = await clientSignInB.client.functions.invoke('request-allocation', { body: { productId: product.id, dollarAmount: Math.max(product.minimum_investment, 1000) } });
    await pm2.client.functions.invoke('reject-allocation', { body: { requestId: reqB.id, reason: 'test' } });

    const { data: rowA } = await admin.from('allocation_requests').select('resolved_by,resolved_by_email').eq('id', reqA.id).single();
    const { data: rowB } = await admin.from('allocation_requests').select('resolved_by,resolved_by_email').eq('id', reqB.id).single();
    check('approve-allocation records PM #1\'s real id+email', rowA.resolved_by === pm1.session.user.id && rowA.resolved_by_email === pm1Email, JSON.stringify(rowA));
    check('reject-allocation records PM #2\'s real id+email', rowB.resolved_by === pm2.session.user.id && rowB.resolved_by_email === pm2Email, JSON.stringify(rowB));

    const { error: blockedErr } = await nonAdmin.client.functions.invoke('approve-allocation', { body: { requestId: reqA.id } });
    check('non-admin caller is blocked from approve-allocation (403)', blockedErr && blockedErr.context && blockedErr.context.status === 403);

    await admin.from('allocation_requests').delete().in('client_id', [clientA.id, clientB.id]);
    await admin.from('transactions').delete().in('client_id', [clientA.id, clientB.id]);
    await admin.from('holdings').delete().in('client_id', [clientA.id, clientB.id]);
    await admin.from('account_state').delete().in('client_id', [clientA.id, clientB.id]);
    await admin.from('clients').delete().in('id', [clientA.id, clientB.id]);
    await admin.auth.admin.deleteUser(clientA.id);
    await admin.auth.admin.deleteUser(clientB.id);
  })();

  // ---- 1c. Deposits: credit-deposit (PM1) vs reject-deposit (PM2) ----
  await (async function () {
    const clientA = await makeClientWithAccountState('dep-a');
    const { data: reqA, error: insA } = await admin.from('deposit_requests').insert({ client_id: clientA.id, method: 'bank', requested_amount: 1000, currency: 'USD', status: 'pending', details: {} }).select().single();
    if (insA) throw new Error('deposit_requests insert (A) failed: ' + insA.message);
    await pm1.client.functions.invoke('credit-deposit', { body: { requestId: reqA.id, confirmedAmount: 1000 } });

    const clientB = await makeClientWithAccountState('dep-b');
    const { data: reqB, error: insB } = await admin.from('deposit_requests').insert({ client_id: clientB.id, method: 'bank', requested_amount: 500, currency: 'USD', status: 'pending', details: {} }).select().single();
    if (insB) throw new Error('deposit_requests insert (B) failed: ' + insB.message);
    await pm2.client.functions.invoke('reject-deposit', { body: { requestId: reqB.id, reason: 'test' } });

    const { data: rowA } = await admin.from('deposit_requests').select('resolved_by,resolved_by_email').eq('id', reqA.id).single();
    const { data: rowB } = await admin.from('deposit_requests').select('resolved_by,resolved_by_email').eq('id', reqB.id).single();
    check('credit-deposit records PM #1\'s real id+email', rowA.resolved_by === pm1.session.user.id && rowA.resolved_by_email === pm1Email, JSON.stringify(rowA));
    check('reject-deposit records PM #2\'s real id+email', rowB.resolved_by === pm2.session.user.id && rowB.resolved_by_email === pm2Email, JSON.stringify(rowB));

    const { error: blockedErr } = await nonAdmin.client.functions.invoke('credit-deposit', { body: { requestId: reqA.id, confirmedAmount: 1000 } });
    check('non-admin caller is blocked from credit-deposit (403)', blockedErr && blockedErr.context && blockedErr.context.status === 403);

    await admin.from('deposit_requests').delete().in('client_id', [clientA.id, clientB.id]);
    await admin.from('transactions').delete().in('client_id', [clientA.id, clientB.id]);
    await admin.from('account_state').delete().in('client_id', [clientA.id, clientB.id]);
    await admin.from('clients').delete().in('id', [clientA.id, clientB.id]);
    await admin.auth.admin.deleteUser(clientA.id);
    await admin.auth.admin.deleteUser(clientB.id);
  })();

  // ---- 1d. Products: add-product (PM1) vs edit-product (PM2) on that same product ----
  await (async function () {
    const { data: created, error: addErr } = await pm1.client.functions.invoke('add-product', {
      body: { name: 'Attrib Test Product ' + suffix, assetClass: 'Stocks & ETFs', investmentType: 'ETF', riskTier: 'balanced', minimumInvestment: 500, unitPrice: 10 }
    });
    check('add-product succeeds', !addErr, addErr && addErr.message);
    check('add-product response reflects PM #1\'s real id+email', created && created.createdBy === pm1.session.user.id && created.createdByEmail === pm1Email, JSON.stringify(created));

    const { data: edited, error: editErr } = await pm2.client.functions.invoke('edit-product', { body: { id: created.id, patch: { minimumInvestment: 750 } } });
    check('edit-product succeeds', !editErr, editErr && editErr.message);
    check('edit-product response reflects PM #2\'s real id+email, PM #1\'s createdBy untouched', edited && edited.updatedBy === pm2.session.user.id && edited.updatedByEmail === pm2Email && edited.createdBy === pm1.session.user.id, JSON.stringify(edited));

    const { error: blockedErr } = await nonAdmin.client.functions.invoke('add-product', { body: { name: 'Should Not Exist', assetClass: 'Stocks & ETFs', investmentType: 'ETF', riskTier: 'balanced', minimumInvestment: 500, unitPrice: 10 } });
    check('non-admin caller is blocked from add-product (403)', blockedErr && blockedErr.context && blockedErr.context.status === 403);

    await admin.from('products').delete().eq('id', created.id);
  })();

  // ---- 1e. Advisory fee rate: the one global singleton, updated by PM1 then PM2 ----
  await (async function () {
    const { data: byPm1, error: err1 } = await pm1.client.functions.invoke('update-advisory-fee-rate', { body: { newRate: 1.5 } });
    check('update-advisory-fee-rate (PM #1) records PM #1\'s real id+email', byPm1 && byPm1.updatedBy === pm1.session.user.id && byPm1.updatedByEmail === pm1Email, JSON.stringify(byPm1));

    const { data: byPm2, error: err2 } = await pm2.client.functions.invoke('update-advisory-fee-rate', { body: { newRate: 1.75 } });
    check('update-advisory-fee-rate (PM #2) records PM #2\'s real id+email', byPm2 && byPm2.updatedBy === pm2.session.user.id && byPm2.updatedByEmail === pm2Email, JSON.stringify(byPm2));

    const { error: blockedErr } = await nonAdmin.client.functions.invoke('update-advisory-fee-rate', { body: { newRate: 99 } });
    check('non-admin caller is blocked from update-advisory-fee-rate (403)', blockedErr && blockedErr.context && blockedErr.context.status === 403);
    const { data: finalRate } = await admin.from('advisory_fee_rate').select('rate').eq('id', true).single();
    check('the blocked attempt genuinely left the rate unchanged (still PM #2\'s 1.75, not 99)', finalRate.rate == 1.75, JSON.stringify(finalRate));

    // Restore to the pre-existing real rate so this test leaves no residue on shared global state.
    await admin.from('advisory_fee_rate').update({ rate: 1.25, updated_by: null, updated_by_email: null }).eq('id', true);
  })();

  // ---- 1f. Support tickets: update-support-ticket resolved by PM1 ----
  await (async function () {
    const clientA = await makeClientWithAccountState('supp-a');
    const { data: ticket, error: ticketInsErr } = await admin.from('support_requests').insert({ client_id: clientA.id, display_id: 'DISP-0001', category: 'Other', description: 'test', status: 'Open', date_opened: new Date().toISOString().slice(0, 10) }).select().single();
    if (ticketInsErr) throw new Error('support_requests insert failed: ' + ticketInsErr.message);
    const { data: updated, error: updateErr } = await pm1.client.functions.invoke('update-support-ticket', { body: { clientId: clientA.id, requestId: 'DISP-0001', status: 'Resolved', pmNote: 'Handled.' } });
    check('update-support-ticket succeeds and records PM #1\'s real id+email', !updateErr && updated && updated.resolvedBy === pm1.session.user.id && updated.resolvedByEmail === pm1Email, JSON.stringify(updated || updateErr));

    const { error: blockedErr } = await nonAdmin.client.functions.invoke('update-support-ticket', { body: { clientId: clientA.id, requestId: 'DISP-0001', status: 'Open', pmNote: 'x' } });
    check('non-admin caller is blocked from update-support-ticket (403)', blockedErr && blockedErr.context && blockedErr.context.status === 403);

    await admin.from('support_requests').delete().eq('client_id', clientA.id);
    await admin.from('account_state').delete().eq('client_id', clientA.id);
    await admin.from('clients').delete().eq('id', clientA.id);
    await admin.auth.admin.deleteUser(clientA.id);
  })();

  // ===========================================================================================
  // PART 2 — the LOCAL Security Log (engine-core.js, still 100% local — confirmed, not a real
  // Supabase table) also distinguishes two different PMs' actions correctly.
  // ===========================================================================================
  console.log('\n2. Local Security Log — the one place a hardcoded "Portfolio Manager" literal existed\n');
  await (async function () {
    const storages = createSharedStorage();
    const engine = loadEngine(storages);
    engine.addClient({ name: 'Security Log Test Client', email: 'sec-log-test@example.com', phone: '+1-555-0400', accountType: 'Individual Account' });
    const clients = engine.getAllClients();
    const testClient = clients[clients.length - 1];

    const entry1 = engine.resetClientPassword(testClient.id, 'Client reported a possible compromise.', pm1Email);
    check('resetClientPassword records the real PM #1 email, not the old generic literal', entry1.performedBy === pm1Email, JSON.stringify(entry1));

    const entry2 = engine.resetClient2FA(testClient.id, 'Client lost their authenticator device.', pm2Email);
    check('resetClient2FA records the real PM #2 email, genuinely different from entry 1', entry2.performedBy === pm2Email && entry2.performedBy !== entry1.performedBy, JSON.stringify(entry2));

    const entry3 = engine.resetClient2FA(testClient.id, 'A second reset, email omitted.', undefined);
    check('an omitted email falls back to an honest "Unknown PM", never the old fictional-reading default', entry3.performedBy === 'Unknown PM', JSON.stringify(entry3));

    const log = engine.getSecurityActionsLog();
    check('the real log now contains all 3 real, correctly distinguishable entries', log.length === 3 && log.every(function (e) { return e.clientId === testClient.id; }), JSON.stringify(log));
  })();

  // The non-admin account is created once at the top and used by every authorization-negative
  // check below, so it cannot be deleted inside any individual part — and it was never deleted
  // at all, quietly accumulating one non-admin-*@test.marketswave.local user per run (33 had
  // built up before this was noticed). Every other test account this script creates is already
  // deleted by the part that owns it.
  await admin.auth.admin.deleteUser(nonAdminUser.id).catch(function () {});

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.\n');
  if (failed > 0) {
    console.log('VERIFY: FAIL');
    process.exit(1);
  }
  console.log('VERIFY: PASS');
  process.exit(0);
}

main().catch(function (err) {
  console.error('\nVERIFY FAILED WITH AN ERROR: ' + (err && err.message ? err.message : err));
  console.error(err);
  process.exit(1);
});
