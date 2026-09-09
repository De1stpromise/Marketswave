/**
 * verify-footer-disclosures.mjs - the condensed footer disclosures and the footer's texture.
 *
 * Checks every page that carries the footer, at desktop and at 320/375/390, because the block
 * is shared markup: a wrapping or overflow problem would ship to all of them at once. Long
 * legal paragraphs at 320px are the specific risk.
 *
 * Also asserts the block is genuinely SECONDARY but genuinely LEGIBLE - smaller and dimmer
 * than the functional footer text, but not shrunk into fine print, since the whole point of
 * this text is that it gets read.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.FD_PORT || 9339);
const BASE = process.env.FD_BASE || 'http://127.0.0.1:8765/';
const SHOTS = process.env.FD_SHOTS || null;
const PAGES = ['about', 'blog-press', 'contact', 'help-center', 'index', 'legal', 'resources', 'services'];

let pass = 0, fail = 0;
const ok = (c, label, detail) => {
  if (c) { pass++; console.log('  PASS  ' + label + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '  [' + detail + ']' : '')); }
};

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.p = new Map();
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.p.has(m.id)) {
        const q = this.p.get(m.id); this.p.delete(m.id);
        if (m.error) q.reject(new Error(m.error.message)); else q.resolve(m.result);
      }
    });
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((res, rej) => { this.p.set(id, { resolve: res, reject: rej }); this.ws.send(JSON.stringify({ id, method, params: params || {} })); });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROBE = `(() => {
  const blk = document.querySelector('.footer-disclosures');
  if (!blk) return { missing: true };
  const ps = [...blk.querySelectorAll('p')];
  const legal = ps.filter((p) => !p.classList.contains('footer-disclosures-more'));
  const link = blk.querySelector('.footer-disclosures-more a');
  const bs = getComputedStyle(blk);
  const ls = getComputedStyle(legal[0]);
  const footerBody = document.querySelector('.footer-brand p');
  const fbs = getComputedStyle(footerBody);
  const overflowing = legal.filter((p) => p.scrollWidth > p.clientWidth + 1).length;
  return {
    missing: false,
    legalCount: legal.length,
    linkHref: link ? link.getAttribute('href') : null,
    linkText: link ? link.textContent.trim() : null,
    rule: bs.borderTopWidth,
    fontPx: parseFloat(ls.fontSize),
    lineHeight: parseFloat(ls.lineHeight) / parseFloat(ls.fontSize),
    color: ls.color,
    footerBodyPx: parseFloat(fbs.fontSize),
    footerBodyColor: fbs.color,
    zIndex: bs.zIndex,
    overflowing,
    bodyScroll: document.body.scrollWidth,
    inner: window.innerWidth,
    // Texture: both decorative layers must genuinely be painting.
    lightBg: getComputedStyle(document.querySelector('.site-footer'), '::before').backgroundImage,
    grainBg: getComputedStyle(document.querySelector('.site-footer'), '::after').backgroundImage,
    grainBlend: getComputedStyle(document.querySelector('.site-footer'), '::after').mixBlendMode,
    grainOpacity: getComputedStyle(document.querySelector('.site-footer'), '::after').opacity
  };
})()`;

async function main() {
  const profile = mkdtempSync(join(tmpdir(), 'mw-fd-'));
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--force-device-scale-factor=1', '--hide-scrollbars', 'about:blank'],
    { stdio: 'ignore' });

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
  await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

  for (const width of [1440, 390, 375, 320]) {
    console.log('\n=== ' + width + 'px ===');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    let allOk = true;
    for (const page of PAGES) {
      await cdp.send('Page.navigate', { url: BASE + page + '.html' });
      await sleep(1200);
      const real = await cdp.eval('window.innerWidth');
      if (real !== width) { ok(false, page + ': viewport integrity', 'got ' + real); allOk = false; continue; }
      const d = await cdp.eval(PROBE);
      const good = !d.missing && d.legalCount === 3 && d.linkHref === 'legal.html#disclosures' &&
                   d.linkText === 'Full disclosures' && d.rule === '1px' &&
                   d.overflowing === 0 && d.bodyScroll <= d.inner &&
                   d.fontPx >= 11 && d.lineHeight >= 1.6 &&
                   d.fontPx < d.footerBodyPx && d.color !== d.footerBodyColor &&
                   Number(d.zIndex) >= 2;
      if (!good) {
        allOk = false;
        ok(false, page + ': footer disclosures', JSON.stringify(d).slice(0, 200));
      }
    }
    if (allOk) ok(true, 'all 8 pages: 3 verbatim paragraphs, hairline rule, working link, no overflow, legible size',
                  'font >= 11px, line-height >= 1.6, smaller+dimmer than footer body');

    if (SHOTS && (width === 1440 || width === 320)) {
      await cdp.send('Page.navigate', { url: BASE + 'index.html' });
      await sleep(1200);
      await cdp.eval('document.querySelector(".footer-disclosures").scrollIntoView({block:"center",behavior:"instant"})');
      await sleep(400);
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(SHOTS, 'footer-' + width + '.png'), Buffer.from(shot.data, 'base64'));
    }
  }

  // Texture, checked once - it is the same shared footer on every page.
  console.log('\n=== footer texture (round-2 spec) ===');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: BASE + 'index.html' });
  await sleep(1200);
  const t = await cdp.eval(PROBE);
  ok(/radial-gradient/.test(t.lightBg), 'radial light present on ::before', t.lightBg.slice(0, 60));
  ok(/url\(/.test(t.grainBg) && /svg/i.test(t.grainBg), 'SVG-turbulence grain present on ::after', t.grainBg.slice(0, 40));
  ok(t.grainBlend === 'screen', 'grain is SCREENED, not multiplied (correct for a dark surface)', t.grainBlend);
  ok(Number(t.grainOpacity) > 0 && Number(t.grainOpacity) <= 0.5, 'grain is barely perceptible', t.grainOpacity);
  ok(Number(t.zIndex) >= 2, 'legal text sits above both decorative layers', 'z-index ' + t.zIndex);

  ws.close(); chrome.kill();
  try { rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'FOOTER DISCLOSURES: FAIL' : 'FOOTER DISCLOSURES: PASS');
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
