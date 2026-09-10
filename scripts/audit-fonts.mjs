/**
 * audit-fonts.mjs - is every font-family this page ASKS for actually LOADED?
 *
 * Referencing a family in CSS is not the same as loading it. When a family is missing, the
 * browser silently substitutes a fallback: no console error, no warning, and the text still
 * renders at the right size and colour, so it survives screenshots and review. This project
 * has shipped that exact bug at least twice (Inter 200/300 absent from the loaded subset,
 * handover row 176; and again below).
 *
 * ★ document.fonts.check() IS NOT A RELIABLE TEST FOR THIS, and this script deliberately does
 * not trust it. Measured on 2026-09-09: on resources.html, check('500 16px "JetBrains Mono"')
 * returned TRUE for a family the page never loads, that has no @font-face in document.fonts,
 * and that is not installed on the machine - i.e. a family that provably renders as a
 * fallback. Chrome reports true whenever the font list can be matched at all, fallback
 * included, so it answers "will this render?" (always yes) rather than "is this family
 * actually being used?".
 *
 * The reliable test is METRIC COMPARISON: render the same string in the requested family and
 * in a deliberately nonexistent family. Identical widths mean both resolved to the same
 * fallback, so the requested family is not being applied. A distinct width means it is.
 * That is a direct measurement of what the reader actually sees.
 *
 * ★ KNOWN LIMITATION — THIS SCRIPT CANNOT VERIFY WEIGHTS WITHIN A MONOSPACE FAMILY.
 * The probe compares TEXT WIDTH, and in a monospace family every weight has the same advance
 * width, so 400, 500 and 700 all measure identically. Measured on asset-performance.html
 * (2026-09-09): JetBrains Mono reported w=297.6 at 400, 500 AND 700 while the document had
 * @font-face entries for 500 and 700 ONLY — so this script reported "LOADED" for a mono
 * weight that does not exist. What actually happens there is not a fallback to another
 * family: CSS font matching resolves the missing 400 to the 500 face, so the text renders
 * one step heavier than authored. Silent, and invisible to this tool.
 *
 * So: a LOADED result here means the FAMILY resolves. It does NOT mean the requested WEIGHT
 * exists. After changing mono weights, check the "@font-face entries" block this script also
 * prints — that list is the real evidence for which weights the document actually has.
 * Proportional families are unaffected: their widths do vary with weight, which is why the
 * Inter weights below are genuinely distinguished.
 *
 * Usage: AUDIT_URL=http://127.0.0.1:8765/resources.html node scripts/audit-fonts.mjs
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.AUDIT_PORT || 9336);
const URLS = (process.env.AUDIT_URL || 'http://127.0.0.1:8765/resources.html').split(',');

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id); this.pending.delete(m.id);
        if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result);
      }
    });
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((res, rej) => { this.pending.set(id, { resolve: res, reject: rej }); this.ws.send(JSON.stringify({ id, method, params: params || {} })); });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const profile = mkdtempSync(join(tmpdir(), 'mw-fontaudit-'));
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });

  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const pg = (await r.json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (pg) wsUrl = pg.webSocketDebuggerUrl; else await sleep(250);
    } catch (e) { await sleep(250); }
  }
  if (!wsUrl) { chrome.kill(); throw new Error('no page target'); }

  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const cdp = new CDP(ws);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');

  let anyFallback = false;

  for (const url of URLS) {
    await cdp.send('Page.navigate', { url });
    await sleep(2500);
    await cdp.eval('document.fonts.ready');

    const report = await cdp.eval(`(() => {
      // Every distinct (family, weight) pair actually USED by a rendered element.
      const used = new Map();
      document.querySelectorAll('*').forEach((el) => {
        if (!el.getClientRects().length) return;
        // Skip the root element. No author rule sets a family on <html> in this project, so it
        // reports the UA default (Times New Roman on Windows) - which then measures identical
        // to a nonexistent family and looks like a fallback. It renders no text of its own
        // (body sets Inter), so it is noise, not a finding.
        if (el === document.documentElement) return;
        const cs = getComputedStyle(el);
        const fam = cs.fontFamily;
        const w = cs.fontWeight;
        const key = fam + '||' + w;
        if (!used.has(key)) used.set(key, { family: fam, weight: w, sample: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/)[0] : ''), count: 0 });
        used.get(key).count++;
      });
      // Metric probe - see this file's header for why document.fonts.check() is not used.
      const ctx = document.createElement('canvas').getContext('2d');
      const SPECIMEN = 'ABCDEFGHIJ 0123456789 reporting';
      const widthIn = (fam, weight) => { ctx.font = weight + ' 16px ' + fam; return ctx.measureText(SPECIMEN).width; };
      const faceNames = new Set();
      document.fonts.forEach((f) => faceNames.add(f.family));

      const out = [];
      for (const v of used.values()) {
        // First family in the stack is what the page is actually asking for.
        const first = v.family.split(',')[0].trim().replace(/^["']|["']$/g, '');
        const generic = ['sans-serif','serif','monospace','system-ui','-apple-system','cursive','fantasy','ui-sans-serif','ui-serif','ui-monospace','ui-rounded','math','emoji','fangsong'].includes(first.toLowerCase());
        let loaded = true, evidence = '';
        if (!generic) {
          const baseline = widthIn('"NoSuchFamily' + Math.random().toString(36).slice(2) + '"', v.weight);
          const actual = widthIn('"' + first + '"', v.weight);
          loaded = Math.abs(actual - baseline) > 0.5;
          evidence = 'w=' + actual.toFixed(1) + ' vs fallback ' + baseline.toFixed(1) +
                     (faceNames.has(first) ? ', @font-face present' : ', NO @font-face');
        }
        out.push({ requested: first, weight: v.weight, generic, loaded, evidence, sample: v.sample, count: v.count });
      }
      const faces = [];
      document.fonts.forEach((f) => faces.push(f.family + ' ' + f.weight + ' [' + f.status + ']'));
      return { out, faces: [...new Set(faces)].sort(), title: document.title };
    })()`);

    console.log('\n=== ' + url + ' ===');
    console.log('  loaded faces: ' + (report.faces.length ? report.faces.join(', ') : '(none)'));
    console.log('');
    for (const r of report.out.sort((a, b) => a.requested.localeCompare(b.requested) || a.weight - b.weight)) {
      if (r.generic) { console.log('  --    ' + r.requested + ' ' + r.weight + '  (generic, nothing to load)  x' + r.count); continue; }
      const status = r.loaded ? 'OK   ' : 'FALLBACK';
      if (!r.loaded) anyFallback = true;
      console.log('  ' + status + ' "' + r.requested + '" @' + r.weight + '  x' + r.count + '  e.g. ' + r.sample + '  [' + r.evidence + ']');
    }
  }

  ws.close(); chrome.kill();
  try { rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  console.log('\n' + (anyFallback ? 'FONT AUDIT: FALLBACK DETECTED' : 'FONT AUDIT: all requested families genuinely loaded'));
  process.exit(anyFallback ? 1 : 0);
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
