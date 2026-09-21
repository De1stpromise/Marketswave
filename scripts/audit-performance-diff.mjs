// audit-performance-diff.mjs — diff two audit-performance.mjs runs, page by page.
// The audit exists so a change is a DIFF, not an impression (app-feel programme, stage 1).
//
// Usage (from scripts/):
//   node audit-performance-diff.mjs .pass-logs/perf/<baseline>.json .pass-logs/perf/<after>.json
//
// Per page (warm pass, the median sample): transfer weight, request count, FCP, shell painted,
// data-ready (with each run's min–max), the SDK's own request count, and the longest function.
// Per navigation hop: time to usable and the shell repaint. A delta is printed as after − before,
// so a negative time is an improvement; the ranges are printed beside the medians because on the
// live site the spread is often as wide as the change being measured.
import { readFileSync } from 'node:fs';

const [a, b] = process.argv.slice(2).map((p) => JSON.parse(readFileSync(p, 'utf8')));
if (!a || !b) { console.error('usage: node audit-performance-diff.mjs <baseline.json> <after.json>'); process.exit(2); }
const kb = (x) => (x / 1024).toFixed(0);
const s = (x) => x == null ? '—' : (x / 1000).toFixed(1);
const d = (x, y) => (x == null || y == null) ? '—' : ((y - x) >= 0 ? '+' : '') + ((y - x) / 1000).toFixed(1);
const range = (r) => r && r.spread ? ' (' + s(r.spread.dataReady[0]) + '–' + s(r.spread.dataReady[1]) + ')' : '';
const sdk = (r) => r.rows.filter((x) => x.cls === 'esm.sh' || x.cls === 'vendor').length;

console.log('baseline ' + a.stamp + '  →  after ' + b.stamp + '   (warm pass medians; Δ = after − before)\n');
console.log('| Page | KB | Δ | Req | Δ | SDK req | FCP s | Δ | Shell s | Δ | Data-ready s (min–max) | after | Δ | Longest fn s | after |');
console.log('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
const by = (run) => Object.fromEntries((run.passes.warm || []).map((r) => [r.label, r]));
const A = by(a), B = by(b);
for (const label of Object.keys(A)) {
  const x = A[label], y = B[label]; if (!y) continue;
  if (x.unreachable || y.unreachable) { console.log('| ' + label + ' | UNREACHABLE in ' + (x.unreachable ? 'baseline' : 'after') + ' run (the site was never reached — not compared) |'); continue; }
  const lf = (r) => r.longestFn && !/track-visit/.test(r.longestFn.path) ? s(r.longestFn.dur) : '—';
  console.log('| ' + label.replace(/\?client=.*/, '?client=…').replace('?product=PROD-0002', '?product=…') + ' | ' + kb(x.bytesTotal) + ' | ' + (kb(y.bytesTotal) - kb(x.bytesTotal)) + ' | ' + x.requests + ' | ' + (y.requests - x.requests) +
    ' | ' + sdk(x) + '→' + sdk(y) + ' | ' + s(x.fcp) + ' | ' + d(x.fcp, y.fcp) + ' | ' + s(x.shellAt) + ' | ' + d(x.shellAt, y.shellAt) +
    ' | ' + s(x.dataReady.ms) + range(x) + ' | ' + s(y.dataReady.ms) + range(y) + ' | ' + d(x.dataReady.ms, y.dataReady.ms) + ' | ' + lf(x) + ' | ' + lf(y) + ' |');
}
const med = (arr) => { const v = arr.filter((n) => n != null).sort((p, q) => p - q); return v.length ? v[Math.floor(v.length / 2)] : null; };
for (const surf of ['client', 'admin', 'public']) {
  const xs = Object.values(A).filter((r) => r.surface === surf), ys = Object.values(B).filter((r) => r.surface === surf);
  if (!xs.length || !ys.length) continue;
  console.log('\n' + surf + ' — medians across pages: data-ready ' + s(med(xs.map((r) => r.dataReady.ms))) + ' → ' + s(med(ys.map((r) => r.dataReady.ms))) + ' s; shell ' + s(med(xs.map((r) => r.shellAt))) + ' → ' + s(med(ys.map((r) => r.shellAt))) + ' s; FCP ' + s(med(xs.map((r) => r.fcp))) + ' → ' + s(med(ys.map((r) => r.fcp))) + ' s; weight ' + kb(med(xs.map((r) => r.bytesTotal))) + ' → ' + kb(med(ys.map((r) => r.bytesTotal))) + ' KB; requests ' + med(xs.map((r) => r.requests)) + ' → ' + med(ys.map((r) => r.requests)));
}
for (const k of ['client', 'admin']) {
  if (!a.nav[k] || !b.nav[k]) continue;
  console.log('\nNavigation, ' + k + ' (warm cache):');
  console.log('| Hop | Usable ms | after | Δ | Shell ms | after | Δ | Net KB | after |');
  console.log('|---|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (let i = 0; i < Math.min(a.nav[k].length, b.nav[k].length); i++) {
    const x = a.nav[k][i], y = b.nav[k][i];
    console.log('| ' + x.label.replace(k + ' ', '').replace(/\.html/g, '') + ' | ' + x.dataReady.ms + ' | ' + y.dataReady.ms + ' | ' + (y.dataReady.ms - x.dataReady.ms) + ' | ' + x.shellAt + ' | ' + y.shellAt + ' | ' + (y.shellAt - x.shellAt) + ' | ' + kb(x.bytesTotal) + ' | ' + kb(y.bytesTotal) + ' |');
  }
  console.log('median usable ' + med(a.nav[k].map((r) => r.dataReady.ms)) + ' → ' + med(b.nav[k].map((r) => r.dataReady.ms)) + ' ms; median shell ' + med(a.nav[k].map((r) => r.shellAt)) + ' → ' + med(b.nav[k].map((r) => r.shellAt)) + ' ms');
}
