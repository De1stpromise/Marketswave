#!/usr/bin/env node
// Supabase Auth Email Branding (2026-09-07). Configures custom SMTP (routing Supabase's own
// native auth emails — currently just the real password-reset one — through Resend, the same
// real, verified marketswave.net-sending account _shared/send-email.ts already uses) on REAL
// CLOUD STAGING ONLY. LOCAL DEV IS DELIBERATELY NEVER TOUCHED BY THIS SCRIPT.
//
// ★ WHY THIS IS ITS OWN SCRIPT, NOT AN [auth.email.smtp] BLOCK IN THE SHARED config.toml —
// investigated and reasoned through directly, not assumed: config.toml is the single source
// `supabase start` (local) AND `supabase config push` (real cloud staging) both read. If
// [auth.email.smtp] lived there with enabled = true, EVERY local `supabase start` would also
// route through real Resend — and this project's own regression suite triggers real
// Supabase-native password-reset emails constantly during normal local development
// (confirmed directly: dozens of times in a single session). That would burn real Resend
// quota on every routine local test run, forever, not just today's already-exhausted case.
// Local dev must keep using Supabase's own free, unlimited default mailer + Mailpit capture.
//
// ★ WHY THE `--workdir` TEMP-COPY TECHNIQUE, not a raw Management API call — investigated
// directly: `supabase config push` already proved itself (this same day) to correctly diff
// the FULL remote [auth] config against local and push only the real difference — hand-rolling
// a raw PATCH to the Management API's own /config/auth endpoint with guessed field names
// risks getting a field wrong and silently reverting or corrupting some OTHER already-correct
// real setting (site_url, additional_redirect_urls — both already fixed and pushed this same
// session) that a minimal, incomplete request body wouldn't preserve. Instead: copy the REAL,
// full, already-correct supabase/ directory into a throwaway temp dir, add ONLY the SMTP
// block to that copy's config.toml, and push FROM there via the CLI's own --workdir flag —
// every other real field pushes as an explicit no-op diff (already matching remote), and only
// the new SMTP block is genuinely new. This also naturally proves the email-TEMPLATE push
// (blocked earlier today with "Email template modification is not available for free tier
// projects... configure a custom SMTP provider") will succeed immediately afterward, since
// this script's own real SMTP config satisfies that exact real platform requirement.
//
// ★ DELIBERATELY NOT RUN AGAINST REAL CLOUD STAGING YET, per direct instruction (2026-09-07):
// the Resend free-tier daily quota was hit mid-session, and enabling live SMTP while quota is
// exhausted risks a WORSE outcome than today's unbranded-but-working default mailer — a real
// user's real password-reset attempt on staging would silently fail to deliver at all. Run
// this ONLY after the quota is confirmed reset AND a real test send can be verified end to
// end (the same discipline every other real-email feature in this project was verified with).
//
// Usage:
//   node scripts/supabase-staging-configure-smtp.js
// Requires: `RESEND_API_KEY` present in supabase/functions/.env (already true — the same key
// _shared/send-email.ts's HTTP-API sends already use; Resend's SMTP relay accepts the exact
// same API key as the SMTP password, confirmed against Resend's own documented SMTP setup —
// host smtp.resend.com, username literally "resend").

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PROJECT_REF = 'ujnmlwbpginplfnofhhv'; // "Marketswave Staging" — the one real project this touches.

function readResendApiKey() {
  const envPath = path.join(PROJECT_ROOT, 'supabase', 'functions', '.env');
  if (!fs.existsSync(envPath)) {
    throw new Error('supabase/functions/.env not found — RESEND_API_KEY must be present there (same key _shared/send-email.ts already uses).');
  }
  const raw = fs.readFileSync(envPath, 'utf8');
  const m = raw.match(/^RESEND_API_KEY=(.+)$/m);
  if (!m) throw new Error('RESEND_API_KEY not found in supabase/functions/.env');
  return m[1].trim();
}

function copyRecursiveSync(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      // .env files (real secrets) are deliberately never copied into the temp workdir — this
      // script only needs config.toml/migrations/functions structure, never the local
      // Edge Function secrets file itself.
      if (entry === '.env') continue;
      copyRecursiveSync(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

async function main() {
  console.log('Configuring custom SMTP (Resend) on real cloud staging (' + PROJECT_REF + ')...\n');

  const resendApiKey = readResendApiKey();
  console.log('Read RESEND_API_KEY from supabase/functions/.env (not printed).\n');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-staging-smtp-push-'));
  console.log('Building a temp copy of supabase/ at: ' + tempDir);
  copyRecursiveSync(path.join(PROJECT_ROOT, 'supabase'), path.join(tempDir, 'supabase'));

  const tempConfigPath = path.join(tempDir, 'supabase', 'config.toml');
  let config = fs.readFileSync(tempConfigPath, 'utf8');

  // Real Resend SMTP relay settings — host/port/user are Resend's own fixed, documented
  // values; the password IS the real Resend API key (read above, never hardcoded here).
  // Deliberately appended (not replacing the existing commented example block above it) so a
  // future diff of config.toml itself stays legible.
  const smtpBlock =
    '\n[auth.email.smtp]\n' +
    'enabled = true\n' +
    'host = "smtp.resend.com"\n' +
    'port = 587\n' +
    'user = "resend"\n' +
    'pass = "' + resendApiKey + '"\n' +
    'admin_email = "noreply@marketswave.net"\n' +
    'sender_name = "Marketswave"\n';
  config += smtpBlock;
  fs.writeFileSync(tempConfigPath, config);
  console.log('Temp config.toml updated with a real [auth.email.smtp] block (real cloud staging only — this temp copy is deleted at the end, never committed).\n');

  try {
    // --workdir expects the PARENT directory containing supabase/ (confirmed directly via a
    // real, harmless `supabase status --workdir <dir>` test before trusting this — passing
    // the supabase/ subdirectory itself, the first natural guess, is wrong and produces a
    // confusing "config file not found"-style error instead).
    console.log('Running: supabase config push --project-ref ' + PROJECT_REF + ' --workdir <temp>\n');
    const out = execSync('supabase config push --project-ref ' + PROJECT_REF + ' --workdir "' + tempDir + '"', {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      stdio: 'pipe'
    });
    console.log(out);
    console.log('\nDone. Real cloud staging now routes Supabase Auth emails (currently just password reset) through Resend/marketswave.net.');
    console.log('NEXT STEP, deliberately not done by this script: trigger one real password reset against');
    console.log('?backend=supabase&env=staging and confirm it actually arrives — this script only configures,');
    console.log('it does not verify delivery.');
  } catch (err) {
    console.error('\nconfig push FAILED: ' + (err.stdout || err.message));
    process.exitCode = 1;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    console.log('\nTemp directory removed: ' + tempDir);
  }
}

main().catch((err) => {
  console.error('FATAL: ' + (err && err.stack || err));
  process.exit(1);
});
