// round-robin-restore.mjs — the restore step for verify-round-robin-refresh that does NOT depend on
// that process ending cleanly (register row 214, built 2026-10-01).
//
// Why outside the process: the suite pauses every local marketswave-* cron job and creates a test
// client, a product (F) and cache rows; its `finally` puts all of that back — but its
// characteristic exits skip `finally` (a watchdog kill; the 0xC0000409 libuv abort; a crash
// mid-series). Five times that left cron PAUSED until someone restored it by hand (rows 211, 214,
// 251, 300). A cleanup that only runs on an orderly shutdown is no cleanup for this suite.
//
// How: the suite writes a JOURNAL (below) before every mutation — cron paused, the original
// cache timestamps, the ids it created. Two independent callers replay it:
//   1. run-round-robin.mjs, the npm entry point, which launches the suite as a CHILD and calls
//      restoreFromJournal() after the child exits — however it exits;
//   2. the suite itself at startup, so a journal left by an earlier crash is repaired first.
// The suite deletes the journal at the end of its own clean `finally`; a journal that still exists
// therefore means "something did not finish", and replaying it is always safe.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const JOURNAL = path.join(HERE, '..', '.pass-logs', 'round-robin-journal.json');

export function writeJournal(state) {
  fs.mkdirSync(path.dirname(JOURNAL), { recursive: true });
  const tmp = JOURNAL + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(Object.assign({ updatedAt: new Date().toISOString() }, state)));
  fs.renameSync(tmp, JOURNAL);   // atomic: a crash mid-write never leaves a torn journal
}
export function readJournal() {
  try { return JSON.parse(fs.readFileSync(JOURNAL, 'utf8')); } catch (_e) { return null; }
}
export function clearJournal() { try { fs.unlinkSync(JOURNAL); } catch (_e) { /* already gone */ } }

export function setSchedulerActive(active) {
  const sql = "select cron.alter_job(jobid, active := " + (active ? 'true' : 'false') + ") from cron.job where jobname like 'marketswave-%'";
  execSync('docker exec supabase_db_Marketswave psql -U postgres -d postgres -At -c "' + sql + '"', { encoding: 'utf8' });
}
function pausedJobs() {
  const out = execSync("docker exec supabase_db_Marketswave psql -U postgres -d postgres -At -c \"select jobname from cron.job where jobname like 'marketswave-%' and not active\"", { encoding: 'utf8' });
  return out.split(/\r?\n/).filter(Boolean);
}

function localAdmin() {
  const require = createRequire(import.meta.url);
  const { createClient } = require('@supabase/supabase-js');
  const raw = execSync('supabase status -o json', { cwd: path.join(HERE, '..', '..'), encoding: 'utf8' });
  const st = JSON.parse(raw.slice(raw.indexOf('{')));
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(st.API_URL)) throw new Error('refusing a non-local API_URL: ' + st.API_URL);
  return createClient(st.API_URL, st.SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

/**
 * Replays the journal if one exists. Returns a report; `ok` is false only if something could not be
 * put back (the caller should fail loudly). With no journal it still checks for paused cron jobs,
 * because a run that died before writing its first journal could still have paused them.
 */
export async function restoreFromJournal(log = console.log) {
  const j = readJournal();
  const report = { journal: !!j, cronRestored: false, cronWasPaused: [], clientRemoved: false, productsRemoved: 0, cacheRowsRemoved: 0, timestampsRestored: 0, problems: [] };
  try { report.cronWasPaused = pausedJobs(); } catch (e) { report.problems.push('could not read cron.job: ' + e.message); }
  if (report.cronWasPaused.length) {
    for (let a = 1; a <= 4 && !report.cronRestored; a++) {
      try { setSchedulerActive(true); report.cronRestored = pausedJobs().length === 0; } catch (e) { if (a === 4) report.problems.push('cron restore failed: ' + e.message); }
      if (!report.cronRestored) await new Promise((r) => setTimeout(r, 1500));
    }
    if (!report.cronRestored) report.problems.push('cron jobs still paused: ' + report.cronWasPaused.join(', '));
  }
  if (j) {
    const admin = localAdmin();
    const c = j.cleanup || {};
    if (c.clientId) {
      await admin.from('price_alerts').delete().eq('client_id', c.clientId);
      await admin.from('watchlist_symbols').delete().eq('client_id', c.clientId);
      await admin.from('holdings').delete().eq('client_id', c.clientId);
      await admin.from('clients').delete().eq('id', c.clientId);
      const { error } = await admin.auth.admin.deleteUser(c.clientId);
      if (error && !/not found/i.test(error.message)) report.problems.push('test client: ' + error.message); else report.clientRemoved = true;
    }
    if ((c.productIds || []).length) {
      const { data, error } = await admin.from('products').delete().in('id', c.productIds).select('id');
      if (error) report.problems.push('test product: ' + error.message); else report.productsRemoved = (data || []).length;
    }
    if ((c.cacheSymbols || []).length) {
      const owned = new Set(((await admin.from('products').select('ticker').in('ticker', c.cacheSymbols)).data || []).map((r) => r.ticker));
      const unowned = c.cacheSymbols.filter((s) => !owned.has(s));
      if (unowned.length) { const { data } = await admin.from('market_data_cache').delete().in('symbol', unowned).select('symbol'); report.cacheRowsRemoved = (data || []).length; }
    }
    for (const r of (j.cacheBefore || [])) {
      const { error } = await admin.from('market_data_cache').update({ last_updated: r.last_updated }).eq('symbol', r.symbol);
      if (!error) report.timestampsRestored++;
    }
  }
  report.ok = report.problems.length === 0;
  if (report.ok) clearJournal();
  log('ROUND-ROBIN RESTORE: ' + (report.ok ? 'OK' : 'INCOMPLETE') + ' — journal ' + (j ? 'found (written ' + (j.updatedAt || '?') + ')' : 'none') +
    '; cron ' + (report.cronWasPaused.length ? (report.cronRestored ? 'RE-ACTIVATED (' + report.cronWasPaused.length + ' were paused)' : 'STILL PAUSED') : 'already active') +
    (j ? '; client ' + (report.clientRemoved ? 'removed' : 'none') + ', products removed ' + report.productsRemoved + ', cache rows removed ' + report.cacheRowsRemoved + ', timestamps restored ' + report.timestampsRestored : '') +
    (report.problems.length ? '; PROBLEMS: ' + report.problems.join(' | ') : ''));
  return report;
}
