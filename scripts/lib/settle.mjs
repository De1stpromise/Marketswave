/* settle.mjs — read a style only after its transition has finished (2026-09-10).
 *
 * ★ WHY THIS EXISTS: THE SAME BUG HAS NOW COST TIME IN THREE SEPARATE TASKS.
 *
 *   row 176  the seam-artifact scenes animate opacity on long cycles, so sampling contrast
 *            at an arbitrary instant caught text mid-fade and reported 1.42:1 for a readout
 *            that is perfectly legible once settled;
 *   row 188  the contrast harness needed a post-settle hook (CONTRAST_PREPARE_JS) because
 *            controls that only exist after a panel opens were measured before they did;
 *   row 190  the floating-label probe reported an IDENTICAL 4.77:1 for the resting and the
 *            focused state. `.mw-fld > label` carries `transition: color 0.16s`, so
 *            getComputedStyle immediately after .focus() returns the PRE-transition colour
 *            and both readings were the resting one.
 *
 * Every occurrence has the same shape and the same fix, which is why it is worth a shared
 * helper rather than a fourth ad-hoc sleep:
 *
 *   ★ A COMPUTED STYLE READ DURING A TRANSITION IS THE OLD VALUE, NOT THE NEW ONE, AND IT
 *     IS A PERFECTLY PLAUSIBLE NUMBER. Nothing throws, nothing warns, and the assertion
 *     passes — while measuring a state you did not intend to measure.
 *
 * WHAT IT DOES DIFFERENTLY FROM A SLEEP
 * A fixed `await sleep(300)` is a guess that silently becomes wrong the moment someone
 * changes a duration or adds a delay. This waits on the REAL animations the element has —
 * `Element.getAnimations({ subtree: true })` returns live CSSTransition objects, each with
 * a `.finished` promise that resolves exactly when that transition ends. The timeout is a
 * backstop for an infinite/looping animation, not the mechanism.
 *
 * USAGE (browser side, inside a cdp.evaluate expression):
 *   [SETTLE_SOURCE, '(async () => {', '  el.focus();', '  await __mwSettle(el);',
 *    '  return getComputedStyle(el).color;', '})()'].join('\n')
 * The evaluate call must pass `awaitPromise: true`, which this project's helpers already do.
 *
 * AND THE GUARD THAT ACTUALLY CATCHES IT
 * Settling is necessary but not sufficient — a probe can still be pointed at the wrong
 * element and read one state twice. `assertDistinct()` is the cheap non-vacuity check that
 * turns "both states measured the same" from a passing assertion into a failing one. Use
 * it whenever a before/after pair is EXPECTED to differ; it is what turned row 190's
 * silent 4.77/4.77 into a real failure.
 */

/** Browser-side source. Concatenate into an evaluate expression before the code that reads
 *  a style. Defines `__mwSettle(el, timeoutMs = 1200)` returning a Promise. */
export const SETTLE_SOURCE = [
  'if (!window.__mwSettle) {',
  '  window.__mwSettle = function (el, timeoutMs) {',
  '    var limit = typeof timeoutMs === "number" ? timeoutMs : 1200;',
  '    var anims = [];',
  '    try {',
  '      // subtree: a label transitions while the probe often holds the wrapper.',
  '      anims = (el && el.getAnimations) ? el.getAnimations({ subtree: true }) : [];',
  '    } catch (e) { anims = []; }',
  '    // A transition that has not started yet is not in the list, so yield one frame',
  '    // first: .focus() queues the style change, it does not apply it synchronously.',
  '    var settled = new Promise(function (resolve) {',
  '      requestAnimationFrame(function () {',
  '        var live = [];',
  '        try { live = (el && el.getAnimations) ? el.getAnimations({ subtree: true }) : []; }',
  '        catch (e) { live = []; }',
  '        Promise.all(live.concat(anims).map(function (a) {',
  '          return a.finished.catch(function () { return null; });',
  '        })).then(function () { requestAnimationFrame(function () { resolve("settled"); }); });',
  '      });',
  '    });',
  '    // Backstop only — a looping animation never finishes, and a probe must not hang.',
  '    var bailout = new Promise(function (resolve) { setTimeout(function () { resolve("timeout"); }, limit); });',
  '    return Promise.race([settled, bailout]);',
  '  };',
  '}',
].join('\n');

/**
 * Non-vacuity guard for a before/after pair that is EXPECTED to differ.
 * Returns { ok, detail } so a caller can feed it straight into its own check().
 */
export function assertDistinct(before, after, what) {
  const a = JSON.stringify(before);
  const b = JSON.stringify(after);
  return {
    ok: a !== b,
    detail: a === b
      ? what + ' read IDENTICALLY in both states (' + a + '). Either the state change never ' +
        'applied, or the read happened before its transition finished — settle first.'
      : what + ': ' + a + ' -> ' + b,
  };
}
