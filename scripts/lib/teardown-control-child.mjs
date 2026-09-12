// The harness-under-test for scripts/verify-harness-teardown.mjs. It uses
// lib/harness-teardown.mjs exactly the way a real visual harness does — makeTempDir, spawn
// a real headless Chrome on that profile, trackChild — then fails in the way the parent asks
// for, so the parent can check what happened to the directory afterwards.
//
//   node lib/teardown-control-child.mjs throw   -> uncaught error mid-run
//   node lib/teardown-control-child.mjs exit    -> process.exit(1) from inside a try
//   node lib/teardown-control-child.mjs hang    -> waits forever, for the parent to hard-kill
//   node lib/teardown-control-child.mjs normal  -> the happy path, await releaseTempDir()
//
// The profile path is printed on stdout as `DIR <path>` once Chrome is confirmed up.

import { spawn } from 'node:child_process';
import { makeTempDir, trackChild, releaseTempDir } from './harness-teardown.mjs';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.CONTROL_PORT || 9461);
const mode = process.argv[2] || 'normal';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const profile = makeTempDir('mw-tdctl-', { label: 'teardown-control:' + mode });
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, '--no-first-run', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });
  trackChild(profile, chrome);
  let up = false;
  for (let i = 0; i < 80 && !up; i++) {
    try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); up = r.ok; } catch (e) { await sleep(250); }
  }
  if (!up) throw new Error('control child: Chrome never came up on port ' + PORT);
  console.log('DIR ' + profile);
  try {
    if (mode === 'throw') throw new Error('control child: deliberate mid-run failure');
    if (mode === 'exit') process.exit(1);
    if (mode === 'hang') { await new Promise(() => {}); }
    await releaseTempDir(profile);
    console.log('RELEASED');
  } finally {
    // Deliberately no cleanup here for the failure modes — the point is to prove the exit
    // hook covers a harness that did not get as far as its own finally.
  }
}

main();
