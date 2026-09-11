/* verify-no-monospace.mjs — the standing guard that JetBrains Mono stays gone (2026-09-10).
 *
 * WHY THIS EXISTS
 * ---------------
 * JetBrains Mono entered this project through design mockups and was then rationalised into a
 * "mono = figures and uppercase micro-labels" rule that was never an approved part of the type
 * scheme. The rule is WITHDRAWN and the family is removed. The scheme is Inter; numeric
 * alignment comes from `font-variant-numeric: tabular-nums`, not from a second family.
 *
 * The risk this guards is specifically REINTRODUCTION, and it is a real one: the old rule was
 * written down in several places, mockups still carry mono, and a future session copying a
 * mockup faithfully would bring it straight back without anything objecting. So this asserts
 * the negative directly.
 *
 * ★ IT ASSERTS TWO GENUINELY DIFFERENT THINGS, AND BOTH ARE NEEDED.
 *   1. No page REQUESTS a monospace face (a stylesheet link or an @font-face). Catches the
 *      download coming back even if nothing uses it yet.
 *   2. No RENDERED ELEMENT resolves to a monospace family. Catches a declaration landing
 *      without the font being requested — which is the worse case, because it renders in a
 *      system fallback and looks merely "a bit off" rather than obviously broken. That is
 *      exactly how resources.html silently shipped a fallback for weeks (row 180).
 *
 * ★ AND IT ASSERTS THE THING THE REMOVAL COULD ACTUALLY BREAK: tabular figures.
 * Equal digit advance was the one genuinely functional job mono was doing. Inter's default
 * figures are PROPORTIONAL, so dropping the family without `tabular-nums` trades a font
 * mismatch for a staggering money column — worse, and less visible. The check measures REAL
 * rendered advance width ("1111111" against "0000000"), because the declaration is inert if
 * the loaded face carries no tnum table; asserting the property string would prove nothing.
 *
 * `support.html`'s ticket id is the one deliberate, disclosed exception — it uses Tailwind's
 * generic `font-mono` and never JetBrains, and it is an identifier, not part of the type
 * scheme. It is listed explicitly rather than silently skipped.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runVerifyMain } from './lib/run-verify.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.MONO_PORT || 9391);
const BASE = process.env.MONO_BASE_URL || 'http://127.0.0.1:8765';

/* The pages that ever carried mono, plus the two the earlier retirement already cleaned —
 * included deliberately so a regression there is caught too, not assumed still fixed. */
const PAGES = ['index.html', 'resources.html', 'login.html', 'about.html', 'services.html',
  'contact.html', 'legal.html', 'help-center.html', 'blog-press.html', 'thank-you.html',
  'signup.html', 'reset-password.html'];

/* Known, deliberate: Tailwind's generic font-mono on a ticket identifier. Not JetBrains, not
 * part of the type scheme, and not a webfont — so it is allowed BY NAME rather than by a
 * blanket exemption that would also hide a genuine regression. */
const ALLOWED_GENERIC_MONO = [{ file: 'support.html', what: 'ticket id (.font-mono, generic ui-monospace)' }];

let passed = 0;
const failures = [];
function check(label, ok, detail) {
  if (ok) { passed++; console.log('  PASS  ' + label); }
  else { failures.push(label); console.log('  FAIL  ' + label + (detail ? '  [' + detail + ']' : '')); }
}

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
  // ---------------------------------------------------------------- static: the source tree
  console.log('\n=== SOURCE — the family is not declared or requested anywhere ===');
  const textFiles = readdirSync(ROOT).filter((f) => /\.(html|css|js)$/.test(f));
  const offenders = [];
  for (const f of textFiles) {
    const body = readFileSync(join(ROOT, f), 'utf8');
    // Strip comments: this file's own removal notes legitimately name the family in prose,
    // and a check that cannot tell prose from a declaration is a check nobody can keep green.
    const code = body.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    if (/JetBrains/i.test(code)) offenders.push(f + ' (declares JetBrains)');
    if (/fonts\.googleapis\.com[^"']*JetBrains/i.test(body)) offenders.push(f + ' (requests JetBrains)');
    if (/@font-face[\s\S]{0,400}?JetBrains/i.test(code)) offenders.push(f + ' (@font-face)');
  }
  check('no source file declares or requests JetBrains Mono (' + textFiles.length + ' files)',
    offenders.length === 0, offenders.join(', '));

  const genericMono = [];
  for (const f of textFiles) {
    const code = readFileSync(join(ROOT, f), 'utf8')
      .replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    if (/\bfont-mono\b/.test(code) || /font-family:[^;]*monospace/i.test(code)) genericMono.push(f);
  }
  const unexpected = genericMono.filter((f) => !ALLOWED_GENERIC_MONO.some((a) => a.file === f));
  check('the only generic-monospace use left is the one disclosed exception (' +
    ALLOWED_GENERIC_MONO.map((a) => a.file + ': ' + a.what).join('; ') + ')',
    unexpected.length === 0, unexpected.join(', '));

  // ---------------------------------------------------------------- rendered
  const profile = mkdtempSync(join(tmpdir(), 'mw-nomono-'));
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
  if (!wsUrl) { chrome.kill(); throw new Error('no CDP page target'); }
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const cdp = new CDP(ws);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');
  // Row 172's lesson: a stale cached stylesheet reported five already-fixed tables as broken.
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

  console.log('\n=== RENDERED — no element resolves to a monospace family ===');
  for (const page of PAGES) {
    await cdp.send('Page.navigate', { url: BASE + '/' + page });
    await sleep(2200);
    await cdp.eval('document.fonts.ready');
    const r = await cdp.eval(`(() => {
      const mono = [];
      document.querySelectorAll('*').forEach((el) => {
        if (!el.getClientRects().length) return;
        const fam = getComputedStyle(el).fontFamily || '';
        if (/JetBrains|monospace|Menlo|SFMono|Consolas|Courier/i.test(fam)) {
          mono.push((el.tagName.toLowerCase()) + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\\s+/)[0] : '') + ' => ' + fam.split(',')[0]);
        }
      });
      const requested = [...document.querySelectorAll('link[rel=stylesheet]')]
        .some((l) => /JetBrains/i.test(l.href));
      return { mono: mono.slice(0, 6), monoCount: mono.length, requested };
    })()`);
    check(page + ': zero elements resolve to a monospace family', r.monoCount === 0, r.mono.join(' | '));
    check(page + ': does not request a monospace face', r.requested === false);
  }

  // ------------------------------------------------- tabular figures actually take effect
  console.log('\n=== TABULAR FIGURES — the one real job mono was doing is preserved ===');
  const FIGURE_SELECTORS = {
    'index.html': ['.fpanel-pg', '.approach-dot', '.values-num', '.hero-tape span'],
    'resources.html': ['.res-n', '.res-dot', '.hiw-row'],
  };
  for (const [page, sels] of Object.entries(FIGURE_SELECTORS)) {
    await cdp.send('Page.navigate', { url: BASE + '/' + page });
    await sleep(2200);
    await cdp.eval('document.fonts.ready');
    const res = await cdp.eval(`(() => {
      const out = [];
      for (const sel of ${JSON.stringify(sels)}) {
        const el = document.querySelector(sel);
        if (!el) { out.push({ sel, missing: true }); continue; }
        const cs = getComputedStyle(el);
        // Measure REAL advance width in this element's own resolved font, rather than
        // trusting the property: a tnum declaration is inert if the face has no such table.
        const c = document.createElement('canvas').getContext('2d');
        const fontBase = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
        c.font = fontBase;
        const proportional = { ones: c.measureText('1111111').width, zeros: c.measureText('0000000').width };
        const span = document.createElement('span');
        span.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font:' + fontBase + ';font-variant-numeric:' + cs.fontVariantNumeric;
        document.body.appendChild(span);
        span.textContent = '1111111'; const tOnes = span.getBoundingClientRect().width;
        span.textContent = '0000000'; const tZeros = span.getBoundingClientRect().width;
        span.remove();
        out.push({ sel, fvn: cs.fontVariantNumeric, family: cs.fontFamily.split(',')[0],
                   tOnes: Math.round(tOnes * 100) / 100, tZeros: Math.round(tZeros * 100) / 100,
                   pOnes: Math.round(proportional.ones * 100) / 100 });
      }
      return out;
    })()`);
    for (const r of res) {
      check(page + ' ' + r.sel + ': renders in Inter, not a mono family',
        !r.missing && /Inter/.test(r.family || ''), r.missing ? 'SELECTOR NOT FOUND' : r.family);
      check(page + ' ' + r.sel + ': digits are tabular — "1111111" and "0000000" measure the same (' +
        r.tOnes + 'px vs ' + r.tZeros + 'px)',
        !r.missing && Math.abs(r.tOnes - r.tZeros) < 0.5, JSON.stringify(r));
    }
  }

  /* ------------------------------------- every control is Inter, not the UA default
   * ★ FORM CONTROLS DO NOT INHERIT font-family. `body { font-family }` never reaches a
   * <button>/<input>/<select>/<textarea> — the UA supplies its own default instead (Arial on
   * Windows). That is not a mono problem, but it is the same failure this file exists to
   * catch: an element silently rendering in a family nobody chose. It shipped that way on
   * every public page from the day they were built until 2026-09-11, and it was invisible
   * precisely because Arial is plausible rather than obviously wrong.
   * styles.css now carries the standard `font-family: inherit` reset; this proves it holds. */
  console.log('\n=== CONTROLS — nothing falls back to the user-agent default ===');
  for (const page of PAGES) {
    await cdp.send('Page.navigate', { url: BASE + '/' + page });
    await sleep(2200);
    await cdp.eval('document.fonts.ready');
    const r = await cdp.eval(`(() => {
      const bad = [];
      document.querySelectorAll('button, input, select, textarea').forEach((el) => {
        if (!el.getClientRects().length) return;
        // Strip any quotes the computed value carries before testing, so the check never
        // depends on how the engine happens to serialise a quoted family name.
        const fam = (getComputedStyle(el).fontFamily || '').replace(/["']/g, '');
        // A component that deliberately sets its own stack on its own root is fine -- the
        // reset is INHERIT precisely so that keeps working (chat-widget.css does this).
        if (/^Inter/i.test(fam)) return;
        if (/^-apple-system|^system-ui|^ui-sans/i.test(fam)) return;
        bad.push(el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + ' => ' + fam.split(',')[0]);
      });
      return { bad: bad.slice(0, 6), count: bad.length, total: document.querySelectorAll('button, input, select, textarea').length };
    })()`);
    check(page + ': every control resolves to Inter or a component stack, never the UA default (' +
      r.total + ' controls)', r.count === 0, r.bad.join(' | '));
  }

  /* ---------------------------------------------- narrow viewports
   * tabular-nums does not just change the FAMILY, it changes each digit's advance width, so a
   * numeral that fitted before can be wider after. That is a real layout risk and the reason
   * this check exists at 320/375/390 rather than being assumed from the desktop pass. */
  console.log('\n=== NARROW VIEWPORTS — tabular figures did not widen anything past the edge ===');
  for (const w of [390, 375]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: 780, deviceScaleFactor: 1, mobile: true });
    for (const page of ['index.html', 'resources.html', 'login.html', 'contact.html', 'signup.html']) {
      await cdp.send('Page.navigate', { url: BASE + '/' + page });
      await sleep(2200);
      await cdp.eval('document.fonts.ready');
      const r = await cdp.eval(`(() => ({ real: document.documentElement.clientWidth, scroll: document.body.scrollWidth }))()`);
      // Batch 1's lesson: the override silently clamps on this build, so a clean pass at a
      // width the browser never actually applied proves nothing. Guard it.
      check(w + 'px ' + page + ': viewport really is ' + w + 'px (integrity guard)', r.real === w, 'got ' + r.real);
      check(w + 'px ' + page + ': no horizontal overflow (scrollWidth ' + r.scroll + ')', r.scroll <= r.real + 1, JSON.stringify(r));
    }
  }
  /* 320px goes through a real same-origin iframe: the top-level override floors at 348px on
   * this build, so asking for 320 at the top level yields a confident false pass. */
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  for (const page of ['index.html', 'resources.html', 'login.html', 'contact.html', 'signup.html']) {
    await cdp.send('Page.navigate', { url: BASE + '/' + page });
    await sleep(1500);
    const r = await cdp.eval(`(async () => {
      const f = document.createElement('iframe');
      f.style.cssText = 'width:320px;height:700px;border:0;position:fixed;left:0;top:0;z-index:99999';
      f.src = ${JSON.stringify(BASE)} + '/' + ${JSON.stringify(page)};
      document.body.appendChild(f);
      await new Promise((res) => { f.addEventListener('load', res); setTimeout(res, 9000); });
      await new Promise((res) => setTimeout(res, 2500));
      const d = f.contentDocument;
      const out = { real: d.documentElement.clientWidth, scroll: d.body.scrollWidth };
      f.remove();
      return out;
    })()`);
    check('320px ' + page + ': real iframe width is 320 (integrity guard)', r.real === 320, 'got ' + r.real);
    check('320px ' + page + ': no horizontal overflow (scrollWidth ' + r.scroll + ')', r.scroll <= r.real + 1, JSON.stringify(r));
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: BASE + '/index.html' });
  await sleep(1500);

  /* NON-VACUITY. A tabular check that would pass on a proportional face proves nothing, so
   * confirm the measurement can actually tell the two apart on this very machine. */
  const control = await cdp.eval(`(() => {
    const mk = (fvn) => { const s = document.createElement('span');
      s.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font:400 13px Inter;font-variant-numeric:' + fvn;
      document.body.appendChild(s); return s; };
    const a = mk('normal'), b = mk('tabular-nums');
    a.textContent = '1111111'; const an = a.getBoundingClientRect().width;
    a.textContent = '0000000'; const az = a.getBoundingClientRect().width;
    b.textContent = '1111111'; const bn = b.getBoundingClientRect().width;
    b.textContent = '0000000'; const bz = b.getBoundingClientRect().width;
    a.remove(); b.remove();
    return { proportionalGap: Math.round(Math.abs(an - az) * 100) / 100, tabularGap: Math.round(Math.abs(bn - bz) * 100) / 100 };
  })()`);
  check('the tabular check can actually fail — Inter without tnum staggers by ' +
    control.proportionalGap + 'px, with tnum by ' + control.tabularGap + 'px',
    control.proportionalGap > 1 && control.tabularGap < 0.5, JSON.stringify(control));

  ws.close(); chrome.kill();
  console.log('\n' + passed + ' passed, ' + failures.length + ' failed');
  if (failures.length) { console.log('NO MONOSPACE: FAIL'); process.exit(1); }
  console.log('NO MONOSPACE: PASS');
}

runVerifyMain(main, { watchdogMs: 600000 });
