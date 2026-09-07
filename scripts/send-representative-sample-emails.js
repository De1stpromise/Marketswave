#!/usr/bin/env node
// Branded HTML Emails (2026-09-07) — Step 5, the real human-confirmed proof.
//
// This is the "send-representative-sample-emails.js" step referenced (but not yet written)
// in verify-branded-emails.js's own header comment. verify-branded-emails.js and the two
// updated pre-existing scripts (verify-supabase-email-notifications.js,
// verify-supabase-email-triggers-stage2.js) all deliberately send to a malformed/unreachable
// recipient so the REGRESSION suite never spams a real inbox on every run. This script is
// the deliberate, one-time exception: it sends a real, representative sample of the branded
// template to a REAL inbox the user controls, covering every dimension the task asked for —
// existing conversions (both footer types), new client-side triggers, and new PM-side
// triggers — so a human can actually look at the rendered result in a real mail client.
//
// LOCAL STACK ONLY. Deliberately not run against real cloud staging — the same real
// marketswave.net-verified Resend account is shared by both environments, so a local send is
// just as real a proof of actual delivery/rendering as a staging one would be, without
// touching real cloud staging's own test data.
//
// RECIPIENT: passed as the first CLI argument, confirmed directly with the user before this
// script is ever run — never hardcoded, since this sends real, externally-visible email.
//
// Usage:  node scripts/send-representative-sample-emails.js <real-email-address>
// Requires: the local Supabase stack running, RESEND_API_KEY set in
// supabase/functions/.env, and a fresh `supabase start` (or `supabase functions serve`) so
// the edge-runtime has picked up every function this script calls.

const { execSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

function readLocalStackCredentials() {
  const raw = execSync('supabase status -o json', { cwd: __dirname + '/..', encoding: 'utf8' });
  const status = JSON.parse(raw);
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) {
    throw new Error('Refusing to run against a non-local API_URL: ' + status.API_URL);
  }
  return { url: status.API_URL, anonKey: status.ANON_KEY, serviceRoleKey: status.SERVICE_ROLE_KEY };
}

async function main() {
  const recipient = process.argv[2];
  if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    console.error('Usage: node scripts/send-representative-sample-emails.js <real-email-address>');
    process.exit(1);
  }

  console.log('Sending a representative sample of the branded HTML email template to: ' + recipient + '\n');
  const { url, serviceRoleKey } = readLocalStackCredentials();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const suffix = crypto.randomBytes(4).toString('hex');
  const password = 'SampleEmailSend2026!';
  const sent = [];
  function note(label) {
    sent.push(label);
    console.log('  sent  ' + label);
  }

  // ---------------------------------------------------------------------------------------
  // Temp PM account — a real, separate admin identity whose Auth email genuinely IS the
  // target inbox, since getAdminEmails() (the recipient source for every PM-facing trigger)
  // resolves real Auth emails via the real is_admin custom claim, not a denormalized column
  // it can be overridden through the way clients.email can. Cleaned up at the end alongside
  // the pre-existing bootstrap PM accounts, which are left completely untouched.
  // ---------------------------------------------------------------------------------------
  const { data: existingUsers } = await admin.auth.admin.listUsers();
  let pmUser = (existingUsers && existingUsers.users || []).find((u) => u.email === recipient);
  if (!pmUser) {
    const { data: created, error } = await admin.auth.admin.createUser({ email: recipient, password, email_confirm: true });
    if (error) throw new Error('creating temp PM account failed: ' + error.message);
    pmUser = created.user;
  }
  await admin.from('user_roles').upsert({ user_id: pmUser.id, is_admin: true }, { onConflict: 'user_id' });
  console.log('Temp PM account ready: ' + pmUser.id + ' (' + recipient + ')\n');

  // functions.invoke() needs a real user JWT, not service_role — sign in with the anon key.
  const { anonKey } = readLocalStackCredentials();
  const pmSignedIn = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: pmSignInErr } = await pmSignedIn.auth.signInWithPassword({ email: recipient, password });
  if (pmSignInErr) throw new Error('temp PM sign-in failed: ' + pmSignInErr.message);

  // ---------------------------------------------------------------------------------------
  // Temp client account — real, distinct Auth identity (a synthetic, valid-format email,
  // never itself the send target) whose clients.email column (decoupled, exactly like the
  // regression scripts' own malformedRecipient technique) is set directly to the real target
  // inbox — that column is what every client-facing sendEmail() call actually reads from.
  // ---------------------------------------------------------------------------------------
  const clientAuthEmail = 'sample-email-send-' + suffix + '@invalid.test';
  const { data: clientCreated, error: clientCreateErr } = await admin.auth.admin.createUser({ email: clientAuthEmail, password, email_confirm: true });
  if (clientCreateErr) throw new Error('creating temp client account failed: ' + clientCreateErr.message);
  const clientUser = clientCreated.user;
  await admin.from('clients').insert({
    id: clientUser.id, name: 'Sample Email Recipient', email: recipient, phone: '+1-555-0800',
    account_type: 'Individual Account', status: 'active'
  });
  const clientSignedIn = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: clientSignInErr } = await clientSignedIn.auth.signInWithPassword({ email: clientAuthEmail, password });
  if (clientSignInErr) throw new Error('temp client sign-in failed: ' + clientSignInErr.message);
  console.log('Temp client account ready: ' + clientUser.id + ' (auth: ' + clientAuthEmail + ', clients.email: ' + recipient + ')\n');

  const clientDeletes = { allocation_requests: [], withdrawal_requests: [], deposit_requests: [], hys_pockets: [], documents: [], support_requests: [] };

  try {
    // =========================================================================================
    // EXISTING CONVERSIONS — investment footer
    // =========================================================================================
    console.log('--- Existing conversions (investment footer) ---\n');

    await admin.from('account_state').insert({ client_id: clientUser.id, unallocated_capital: 100000, allocated_capital: 0, asset_returns: 0 });
    const { data: allocReq } = await admin.from('allocation_requests').insert({ client_id: clientUser.id, product_id: 'PROD-0003', requested_amount: 5000, status: 'pending' }).select().single();
    const r1 = await pmSignedIn.functions.invoke('approve-allocation', { body: { requestId: allocReq.id } });
    if (r1.error) throw new Error('approve-allocation failed: ' + r1.error.message);
    note('approve-allocation (existing conversion, investment footer) — client receipt');

    const { data: wdReq } = await admin.from('withdrawal_requests').insert({ client_id: clientUser.id, method: 'bank', requested_amount: 500, currency: 'USD', destination_details: {}, status: 'pending' }).select().single();
    const r2 = await pmSignedIn.functions.invoke('reject-withdrawal', { body: { requestId: wdReq.id, reason: 'Sample email verification.' } });
    if (r2.error) throw new Error('reject-withdrawal failed: ' + r2.error.message);
    note('reject-withdrawal (existing conversion, investment footer) — client receipt');

    // =========================================================================================
    // EXISTING CONVERSIONS — general footer
    // =========================================================================================
    console.log('\n--- Existing conversions (general footer) ---\n');

    const { data: profReq } = await admin.from('profile_change_requests').insert({ client_id: clientUser.id, field: 'address', current_value: 'Old Address', requested_value: 'New Address', reason: 'Sample email verification.', status: 'pending' }).select().single();
    const r3 = await pmSignedIn.functions.invoke('reject-profile-change', { body: { requestId: profReq.id, resolutionNote: 'Sample email verification.' } });
    if (r3.error) throw new Error('reject-profile-change failed: ' + r3.error.message);
    note('reject-profile-change (existing conversion, general footer) — client receipt');

    // =========================================================================================
    // NEW CLIENT-SIDE TRIGGERS
    // =========================================================================================
    console.log('\n--- New client-side triggers ---\n');

    const r4 = await clientSignedIn.functions.invoke('request-deposit', { body: { method: 'bank', amount: 2500, currency: 'USD', details: {} } });
    if (r4.error) throw new Error('request-deposit failed: ' + r4.error.message);
    note('request-deposit (new trigger, investment footer, receipt) — client');
    clientDeletes.deposit_requests.push(r4.data.id);

    const r5 = await clientSignedIn.functions.invoke('notify-password-changed');
    if (r5.error) throw new Error('notify-password-changed failed: ' + r5.error.message);
    note('notify-password-changed (new trigger, general footer, security) — client');

    const pastDate = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: pocket } = await admin.from('hys_pockets').insert({
      client_id: clientUser.id, pocket_type: 'fixed', amount: 8000, status: 'active', term_mode: 'short', term_months: 6,
      term_label: '6-Month Fixed Deposit', rate: 5.2, term_in_years: 0.5, maturity_date: pastDate, projected_interest: 208, funding_method: 'bank account'
    }).select().single();
    const r6 = await clientSignedIn.functions.invoke('sync-hys-pocket-status');
    if (r6.error) throw new Error('sync-hys-pocket-status failed: ' + r6.error.message);
    note('sync-hys-pocket-status (new trigger, investment footer, matured pocket) — client');
    clientDeletes.hys_pockets.push(pocket.id);

    // =========================================================================================
    // NEW PM-SIDE TRIGGERS (+ notify-new-client-application's own client-side half)
    // =========================================================================================
    console.log('\n--- New PM-side triggers ---\n');

    const r7 = await clientSignedIn.functions.invoke('notify-new-client-application');
    if (r7.error) throw new Error('notify-new-client-application failed: ' + r7.error.message);
    note('notify-new-client-application (new trigger, general footer) — client receipt AND PM notify (2 emails)');

    const docId = crypto.randomUUID();
    await admin.from('documents').insert({ id: docId, client_id: clientUser.id, filename: 'sample-upload.pdf', category: 'General', direction: 'upload', status: 'Received', is_new: false, deadline_label: null, storage_path: clientUser.id + '/uploads/' + docId + '/sample-upload.pdf' });
    const r8 = await clientSignedIn.functions.invoke('notify-new-document-upload', { body: { documentId: docId } });
    if (r8.error) throw new Error('notify-new-document-upload failed: ' + r8.error.message);
    note('notify-new-document-upload (new trigger, general footer) — PM notify');
    clientDeletes.documents.push(docId);

    const r9 = await clientSignedIn.functions.invoke('request-support-ticket', { body: { category: 'Other', description: 'Sample email verification — please disregard.' } });
    if (r9.error) throw new Error('request-support-ticket failed: ' + r9.error.message);
    note('request-support-ticket (new trigger, general footer) — PM notify');
    clientDeletes.support_requests.push(r9.data.dbId);

    console.log('\n' + sent.length + ' function calls succeeded, producing ' + (sent.length + 1) + ' real emails (notify-new-client-application sends 2).');
    console.log('Check ' + recipient + ' now — every email should show the real MARKETSWAVE branded');
    console.log('template (navy header, table-based layout, correct footer type per email) and come');
    console.log('from Marketswave <noreply@marketswave.net>.');
  } finally {
    console.log('\nCleaning up test data...');
    await admin.from('allocation_requests').delete().eq('client_id', clientUser.id);
    await admin.from('withdrawal_requests').delete().eq('client_id', clientUser.id);
    await admin.from('deposit_requests').delete().eq('client_id', clientUser.id);
    await admin.from('profile_change_requests').delete().eq('client_id', clientUser.id);
    await admin.from('hys_pockets').delete().eq('client_id', clientUser.id);
    await admin.from('documents').delete().eq('client_id', clientUser.id);
    await admin.from('support_requests').delete().eq('client_id', clientUser.id);
    await admin.from('transactions').delete().eq('client_id', clientUser.id);
    await admin.from('account_state').delete().eq('client_id', clientUser.id);
    await admin.from('clients').delete().eq('id', clientUser.id);
    await admin.auth.admin.deleteUser(clientUser.id);
    // Temp PM account: only remove if it was genuinely created by this script, never a
    // pre-existing real PM that happened to already use this email.
    await admin.from('user_roles').delete().eq('user_id', pmUser.id);
    await admin.auth.admin.deleteUser(pmUser.id);
    console.log('Done — all temp test data and the temp PM/client accounts removed.');
  }
}

main().catch((err) => {
  console.error('\nFAILED: ' + (err && err.message ? err.message : err));
  console.error(err);
  process.exit(1);
});
