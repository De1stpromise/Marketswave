// article-blocks.ts — the block model for long-form articles (2026-09-23).
//
// ★ SHARED ON PURPOSE. The Help Center is the first user, the blog is the second. Nothing in
// here says "help": an article is a slug, a title, a question it answers, an opening paragraph
// and an ORDERED LIST OF TYPED BLOCKS. Add a consumer, not a copy.
//
// ★ CONTENT IS STRUCTURED JSON AND NEVER HTML — this is the whole sanitisation story, carried
// over from _shared/fund-document.ts (row 200). There is no key anywhere in this model that can
// hold a tag, an attribute, a URL or a style, so a <script> is not REPRESENTABLE: it can only
// ever be stored as literal characters in a `t` field and painted as literal characters by a
// renderer that uses createElement/textContent. Validation is an ALLOWLIST that refuses an
// unknown key outright rather than stripping a dangerous one from a permissive format.

export type Run = { t: string; b?: true; i?: true };

export type Block =
  | { type: 'heading'; text: string }
  | { type: 'p'; runs: Run[] }
  | { type: 'steps'; steps: { title: string; body: Run[] }[] }
  | { type: 'warning'; title: string; body: Run[] }
  | { type: 'tip'; body: Run[] }
  | { type: 'image'; path: string; alt: string; caption?: string };

export const BLOCK_TYPES = ['heading', 'p', 'steps', 'warning', 'tip', 'image'] as const;

export const MAX_TITLE = 80;
export const MAX_QUESTION = 120;
export const MAX_LEDE = 400;
export const MAX_HEADING = 90;
export const MAX_BLOCKS = 60;
export const MAX_STEPS = 12;
export const MAX_RELATED = 3;
export const MAX_MOST_ASKED = 6;          // the landing's "Most asked" holds at most 6
export const MAX_FEATURED_PER_TOPIC = 3;  // each topic card features at most 3
export const RUN_TEXT_CAP = 4000;

// The in-product placements a "Need help?" link can be attached to. Phase 2 renders them; the
// value is stored and validated from Phase 1 so an article can be configured before then.
export const PRODUCT_SLOTS = ['crypto-deposit', 'allocation', 'savings', 'signing'] as const;

function onlyKeys(o: Record<string, unknown>, allowed: string[]): string | null {
  for (const k of Object.keys(o)) if (allowed.indexOf(k) === -1) return k;
  return null;
}
function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function validateRun(v: unknown, where: string): string | null {
  if (!isObj(v)) return where + ': each run must be an object.';
  const bad = onlyKeys(v, ['t', 'b', 'i']);
  if (bad) return where + ': unknown key "' + bad + '".';
  if (typeof v.t !== 'string') return where + ': t must be a string.';
  if (v.t.length > RUN_TEXT_CAP) return where + ': run text is too long.';
  if ('b' in v && v.b !== true) return where + ': b must be true when present.';
  if ('i' in v && v.i !== true) return where + ': i must be true when present.';
  return null;
}

export function validateRuns(v: unknown, where: string): string | null {
  if (!Array.isArray(v)) return where + ': must be an array of runs.';
  for (let i = 0; i < v.length; i++) {
    const e = validateRun(v[i], where + ' run ' + (i + 1));
    if (e) return e;
  }
  return null;
}

export function runsText(runs: unknown): string {
  if (!Array.isArray(runs)) return '';
  return runs.map((r) => (isObj(r) && typeof r.t === 'string' ? r.t : '')).join('');
}

/** Every word of readable text in an article — used for reading time and the empty check. */
export function blocksPlainText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return '';
  const out: string[] = [];
  for (const b of blocks) {
    if (!isObj(b)) continue;
    if (b.type === 'heading') out.push(String(b.text || ''));
    else if (b.type === 'p') out.push(runsText(b.runs));
    else if (b.type === 'tip') out.push(runsText(b.body));
    else if (b.type === 'warning') { out.push(String(b.title || '')); out.push(runsText(b.body)); }
    else if (b.type === 'steps' && Array.isArray(b.steps)) {
      for (const s of b.steps) {
        if (isObj(s)) { out.push(String(s.title || '')); out.push(runsText(s.body)); }
      }
    } else if (b.type === 'image') out.push(String(b.caption || ''));
  }
  return out.join(' ');
}

/** Reading time in whole minutes, floor 1 — the figure the editor shows as "from length". */
export function readingMinutes(lede: string, blocks: unknown): number {
  const words = ((lede || '') + ' ' + blocksPlainText(blocks)).trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

export function validateBlocks(value: unknown, where = 'body'): string | null {
  if (!Array.isArray(value)) return where + ': must be an array of blocks.';
  if (value.length > MAX_BLOCKS) return where + ': at most ' + MAX_BLOCKS + ' blocks.';
  for (let i = 0; i < value.length; i++) {
    const b = value[i];
    const w = where + ' block ' + (i + 1);
    if (!isObj(b)) return w + ': must be an object.';
    if (typeof b.type !== 'string' || (BLOCK_TYPES as readonly string[]).indexOf(b.type) === -1) {
      return w + ': type must be one of ' + BLOCK_TYPES.join(', ') + '.';
    }
    if (b.type === 'heading') {
      const bad = onlyKeys(b, ['type', 'text']); if (bad) return w + ': unknown key "' + bad + '".';
      if (typeof b.text !== 'string' || !b.text.trim()) return w + ': a heading needs text.';
      if (b.text.length > MAX_HEADING) return w + ': heading is too long.';
    } else if (b.type === 'p') {
      const bad = onlyKeys(b, ['type', 'runs']); if (bad) return w + ': unknown key "' + bad + '".';
      const e = validateRuns(b.runs, w); if (e) return e;
    } else if (b.type === 'tip') {
      const bad = onlyKeys(b, ['type', 'body']); if (bad) return w + ': unknown key "' + bad + '".';
      const e = validateRuns(b.body, w); if (e) return e;
    } else if (b.type === 'warning') {
      const bad = onlyKeys(b, ['type', 'title', 'body']); if (bad) return w + ': unknown key "' + bad + '".';
      if (typeof b.title !== 'string' || !b.title.trim()) return w + ': a warning needs a title.';
      if (b.title.length > MAX_HEADING) return w + ': warning title is too long.';
      const e = validateRuns(b.body, w); if (e) return e;
    } else if (b.type === 'steps') {
      const bad = onlyKeys(b, ['type', 'steps']); if (bad) return w + ': unknown key "' + bad + '".';
      if (!Array.isArray(b.steps) || b.steps.length === 0) return w + ': a steps block needs at least one step.';
      if (b.steps.length > MAX_STEPS) return w + ': at most ' + MAX_STEPS + ' steps.';
      for (let s = 0; s < b.steps.length; s++) {
        const st = b.steps[s]; const sw = w + ' step ' + (s + 1);
        if (!isObj(st)) return sw + ': must be an object.';
        const sbad = onlyKeys(st, ['title', 'body']); if (sbad) return sw + ': unknown key "' + sbad + '".';
        if (typeof st.title !== 'string' || !st.title.trim()) return sw + ': needs a title.';
        if (st.title.length > MAX_HEADING) return sw + ': title is too long.';
        const e = validateRuns(st.body, sw); if (e) return e;
      }
    } else if (b.type === 'image') {
      const bad = onlyKeys(b, ['type', 'path', 'alt', 'caption']); if (bad) return w + ': unknown key "' + bad + '".';
      if (typeof b.path !== 'string' || !b.path.trim()) return w + ': an image needs a stored file.';
      if (typeof b.alt !== 'string') return w + ': alt must be a string.';
      if ('caption' in b && typeof b.caption !== 'string') return w + ': caption must be a string.';
    }
  }
  return null;
}

export function slugFromTitle(title: string): string {
  return String(title || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 80);
}

// ----------------------------------------------------------------------------------------------
// ★ THE PUBLISH CHECKLIST. Returned as a list so the editor can TICK each line and the server can
// REFUSE on the same list — ONE definition, so a disabled button and a 400 can never disagree.
// Order matches the editor's "Ready to publish?" card, top to bottom.
export type ChecklistItem = { key: string; label: string; ok: boolean; optional?: true };

export type ChecklistInput = {
  title?: unknown; question?: unknown; topic_id?: unknown; slug?: unknown;
  lede?: unknown; blocks?: unknown; related_slugs?: unknown;
};

export function publishChecklist(a: ChecklistInput): ChecklistItem[] {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const blocks = Array.isArray(a.blocks) ? a.blocks : [];
  const images = blocks.filter((b) => isObj(b) && b.type === 'image');
  return [
    { key: 'title',    label: 'Title',                   ok: !!str(a.title) },
    { key: 'question', label: 'The question it answers', ok: !!str(a.question) },
    { key: 'place',    label: 'Topic and web address',   ok: !!str(a.topic_id) && !!str(a.slug) },
    { key: 'lede',     label: 'Opening paragraph',       ok: !!str(a.lede) },
    { key: 'body',     label: 'At least one body block', ok: blocks.length > 0 },
    {
      key: 'alt', label: 'Every image has a screen-reader description',
      ok: images.every((b) => isObj(b) && typeof b.alt === 'string' && b.alt.trim().length > 0),
    },
    {
      key: 'related', label: 'Related articles', optional: true,
      ok: Array.isArray(a.related_slugs) && a.related_slugs.length > 0,
    },
  ];
}

/** null when the article may be published; otherwise the reason, naming every missing item. */
export function publishBlocker(a: ChecklistInput): string | null {
  const missing = publishChecklist(a).filter((c) => !c.ok && !c.optional);
  if (missing.length === 0) return null;
  const names = missing.map((m) => m.label.toLowerCase());
  return 'This article is not ready to publish: ' + names.join(', ') +
    (missing.length === 1 ? ' is missing.' : ' are missing.');
}
