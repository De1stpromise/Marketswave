// ★ Product catalog — fund documents, part 2 of 2 (2026-09-12).
//
// The one source of truth for what a fund document IS: the rich-text model, the section
// model, the fixed ordering, the character caps, and what "complete enough to publish"
// means. save-product-document validates every write through here; get-product-document
// hands out only what has already passed it. The browser-side counterpart (rich-text.js /
// fund-document.js) renders this exact shape — it never invents a field this file does not
// name, and this file never accepts one.
//
// ---------------------------------------------------------------------------
// RICH TEXT — a structured model, never HTML.
//   { blocks: Block[] }
//   Block  = { type: 'p',  runs: Run[] }
//          | { type: 'ul', items: Run[][] }
//          | { type: 'ol', items: Run[][] }
//   Run    = { t: string, b?: true, i?: true }
// Exactly these keys, exactly these types. There is no key that can carry a tag, an
// attribute, a URL, or a style, so a script cannot be REPRESENTED, let alone stored — which
// is what "sanitised on the way in" means here: the validator rejects any unknown key or
// type outright rather than trying to strip dangerous ones from a permissive format. Text is
// plain text; the client renders it with textContent, never innerHTML, so "<script>" typed
// into a paragraph is stored as those eight characters and painted as those eight
// characters. The model is deliberately minimal — bold, italic, bullets, numbers — because
// that is the whole feature.
// ---------------------------------------------------------------------------
export type Run = { t: string; b?: true; i?: true };
export type Block = { type: 'p'; runs: Run[] } | { type: 'ul' | 'ol'; items: Run[][] };
export type RichText = { blocks: Block[] };

export const CAPS: Record<string, number> = { overview: 600, strategy: 2000, risks: 1200 };
export const CUSTOM_BODY_SANITY_CAP = 20000;   // "uncapped" for a PM; a ceiling against abuse
export const MAX_CUSTOM_SECTIONS = 40;
export const MAX_HEADING = 80;
export const VALUATION_FREQUENCIES = ['Continuous (market price)', 'Daily', 'Monthly', 'Quarterly', 'Semi-annual', 'Annual'];

// The fixed order. Custom sections may appear ONLY between 'valuation' and 'risks'.
export const FIXED_ORDER = ['overview', 'strategy', 'terms', 'valuation', 'risks', 'documents'];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function onlyKeys(obj: Record<string, unknown>, allowed: string[]): string | null {
  for (const k of Object.keys(obj)) if (allowed.indexOf(k) === -1) return k;
  return null;
}

// Control characters other than none: a run holds ONE line of text. Newlines are block
// boundaries in this model, so a run containing one is malformed, not "multi-line".
const BAD_TEXT = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\n\r]/;

function validateRun(run: unknown, where: string): string | null {
  if (!isPlainObject(run)) return where + ': a run must be an object.';
  const extra = onlyKeys(run, ['t', 'b', 'i']);
  if (extra) return where + ': unknown run key "' + extra + '".';
  if (typeof run.t !== 'string') return where + ': run text must be a string.';
  if (BAD_TEXT.test(run.t)) return where + ': run text may not contain line breaks or control characters.';
  if ('b' in run && run.b !== true) return where + ': "b" may only be true.';
  if ('i' in run && run.i !== true) return where + ': "i" may only be true.';
  return null;
}
function validateRuns(runs: unknown, where: string): string | null {
  if (!Array.isArray(runs)) return where + ': runs must be an array.';
  for (let i = 0; i < runs.length; i++) { const e = validateRun(runs[i], where + ' run ' + (i + 1)); if (e) return e; }
  return null;
}

export function validateRichText(value: unknown, where: string): string | null {
  if (!isPlainObject(value)) return where + ' must be a rich-text object.';
  const extra = onlyKeys(value, ['blocks']);
  if (extra) return where + ': unknown key "' + extra + '".';
  if (!Array.isArray(value.blocks)) return where + ': blocks must be an array.';
  for (let i = 0; i < value.blocks.length; i++) {
    const b = value.blocks[i];
    const w = where + ' block ' + (i + 1);
    if (!isPlainObject(b)) return w + ': a block must be an object.';
    if (b.type === 'p') {
      const bad = onlyKeys(b, ['type', 'runs']); if (bad) return w + ': unknown key "' + bad + '".';
      const e = validateRuns(b.runs, w); if (e) return e;
    } else if (b.type === 'ul' || b.type === 'ol') {
      const bad = onlyKeys(b, ['type', 'items']); if (bad) return w + ': unknown key "' + bad + '".';
      if (!Array.isArray(b.items)) return w + ': items must be an array.';
      for (let j = 0; j < b.items.length; j++) { const e = validateRuns(b.items[j], w + ' item ' + (j + 1)); if (e) return e; }
    } else {
      return w + ': block type must be "p", "ul" or "ol".';
    }
  }
  return null;
}

// The character count a PM sees — every run's text, plus one for each block/item boundary
// after the first. rich-text.js's plainLength() must agree; a verification asserts it does.
export function plainLength(rt: RichText): number {
  let n = 0; let pieces = 0;
  for (const b of rt.blocks) {
    if (b.type === 'p') { n += b.runs.reduce((s, r) => s + r.t.length, 0); pieces++; }
    else for (const item of b.items) { n += item.reduce((s, r) => s + r.t.length, 0); pieces++; }
  }
  return n + Math.max(0, pieces - 1);
}
export function plainText(rt: RichText): string {
  const out: string[] = [];
  for (const b of rt.blocks) {
    if (b.type === 'p') out.push(b.runs.map((r) => r.t).join(''));
    else for (const item of b.items) out.push(item.map((r) => r.t).join(''));
  }
  return out.join('\n');
}
export function isEmptyRichText(rt: RichText): boolean {
  return plainText(rt).trim().length === 0;
}
export const EMPTY_RICH_TEXT: RichText = { blocks: [] };

// ---------------------------------------------------------------------------
// SECTIONS — an ORDERED array carrying fixed and custom sections alike, so the ordering is
// something the server checks rather than something the UI happens to produce:
//   { key: 'overview' | 'strategy' | 'risks', body: RichText }
//   { key: 'terms', horizon: string, valuationFrequency: string, fees: string }
//   { key: 'valuation' }                         — never authored; generated from NAVs
//   { key: 'custom', heading: string, body: RichText }
//   { key: 'documents', attachment: null | { path, name, size, contentType } }
// ---------------------------------------------------------------------------
export type Attachment = { path: string; name: string; size: number; contentType: string };
export type Section =
  | { key: 'overview' | 'strategy' | 'risks'; body: RichText }
  | { key: 'terms'; horizon: string; valuationFrequency: string; fees: string }
  | { key: 'valuation' }
  | { key: 'custom'; heading: string; body: RichText }
  | { key: 'documents'; attachment: Attachment | null };
export type DocumentContent = { sections: Section[] };

function validateShortText(v: unknown, label: string, max: number): string | null {
  if (typeof v !== 'string') return label + ' must be a string.';
  if (BAD_TEXT.test(v)) return label + ' may not contain line breaks or control characters.';
  if (v.length > max) return label + ' must be at most ' + max + ' characters.';
  return null;
}

function validateAttachment(a: unknown, productId: string): string | null {
  if (a === null || a === undefined) return null;
  if (!isPlainObject(a)) return 'attachment must be an object or null.';
  const extra = onlyKeys(a, ['path', 'name', 'size', 'contentType']);
  if (extra) return 'attachment: unknown key "' + extra + '".';
  if (typeof a.path !== 'string' || !a.path.startsWith(productId + '/') || a.path.indexOf('..') !== -1) {
    return 'attachment.path must sit under this product\'s own folder.';
  }
  const e = validateShortText(a.name, 'attachment.name', 200); if (e) return e;
  if (!(a.name as string).trim()) return 'attachment.name is required.';
  if (typeof a.size !== 'number' || !isFinite(a.size) || a.size < 0) return 'attachment.size must be a non-negative number.';
  const e2 = validateShortText(a.contentType, 'attachment.contentType', 120); if (e2) return e2;
  return null;
}

// Validates and CANONICALISES. Returns the content to store, or an error message.
//   strict=false — a draft: shape and caps are enforced, emptiness is not.
//   strict=true  — publishing: the required sections must actually say something.
export function validateDocumentContent(input: unknown, productId: string, strict: boolean): { content?: DocumentContent; error?: string } {
  if (!isPlainObject(input)) return { error: 'The document must be an object.' };
  const extra = onlyKeys(input, ['sections']);
  if (extra) return { error: 'Unknown document key "' + extra + '".' };
  const sections = input.sections;
  if (!Array.isArray(sections)) return { error: 'sections must be an array.' };

  // 1. Every entry is a well-formed section of a known kind.
  const out: Section[] = [];
  let customCount = 0;
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const w = 'Section ' + (i + 1);
    if (!isPlainObject(s)) return { error: w + ' must be an object.' };
    const key = s.key;
    if (key === 'overview' || key === 'strategy' || key === 'risks') {
      const bad = onlyKeys(s, ['key', 'body']); if (bad) return { error: w + ' (' + key + '): unknown key "' + bad + '".' };
      const e = validateRichText(s.body, w + ' (' + key + ') body'); if (e) return { error: e };
      const len = plainLength(s.body as RichText);
      if (len > CAPS[key]) return { error: capMessage(key, len) };
      out.push({ key, body: s.body as RichText });
    } else if (key === 'terms') {
      const bad = onlyKeys(s, ['key', 'horizon', 'valuationFrequency', 'fees']); if (bad) return { error: w + ' (terms): unknown key "' + bad + '".' };
      const e1 = validateShortText(s.horizon, 'Expected horizon', 60); if (e1) return { error: e1 };
      const e2 = validateShortText(s.fees, 'Fees', 120); if (e2) return { error: e2 };
      if (typeof s.valuationFrequency !== 'string' || (s.valuationFrequency !== '' && VALUATION_FREQUENCIES.indexOf(s.valuationFrequency) === -1)) {
        return { error: 'Valuation frequency must be one of: ' + VALUATION_FREQUENCIES.join(', ') + '.' };
      }
      out.push({ key: 'terms', horizon: (s.horizon as string).trim(), valuationFrequency: s.valuationFrequency, fees: (s.fees as string).trim() });
    } else if (key === 'valuation') {
      const bad = onlyKeys(s, ['key']); if (bad) return { error: 'Valuation history is generated from published NAVs and cannot be authored (unexpected key "' + bad + '").' };
      out.push({ key: 'valuation' });
    } else if (key === 'custom') {
      const bad = onlyKeys(s, ['key', 'heading', 'body']); if (bad) return { error: w + ' (custom): unknown key "' + bad + '".' };
      const e1 = validateShortText(s.heading, 'A custom section heading', MAX_HEADING); if (e1) return { error: e1 };
      const e2 = validateRichText(s.body, w + ' (custom) body'); if (e2) return { error: e2 };
      const len = plainLength(s.body as RichText);
      if (len > CUSTOM_BODY_SANITY_CAP) return { error: 'A custom section body must be at most ' + CUSTOM_BODY_SANITY_CAP.toLocaleString('en-US') + ' characters.' };
      customCount++;
      if (customCount > MAX_CUSTOM_SECTIONS) return { error: 'A document may have at most ' + MAX_CUSTOM_SECTIONS + ' custom sections.' };
      out.push({ key: 'custom', heading: (s.heading as string).trim(), body: s.body as RichText });
    } else if (key === 'documents') {
      const bad = onlyKeys(s, ['key', 'attachment']); if (bad) return { error: w + ' (documents): unknown key "' + bad + '".' };
      const e = validateAttachment(s.attachment, productId); if (e) return { error: e };
      out.push({ key: 'documents', attachment: (s.attachment as Attachment) || null });
    } else {
      return { error: w + ': unknown section key "' + String(key) + '".' };
    }
  }

  // 2. The fixed sections: each exactly once, in the fixed order; custom only in its slot.
  const fixedSeen = out.filter((s) => s.key !== 'custom').map((s) => s.key);
  for (const k of FIXED_ORDER) {
    const n = fixedSeen.filter((x) => x === k).length;
    if (n === 0) return { error: 'The "' + k + '" section is missing.' };
    if (n > 1) return { error: 'The "' + k + '" section appears more than once.' };
  }
  if (fixedSeen.join(',') !== FIXED_ORDER.join(',')) {
    return { error: 'Fixed sections must appear in this order: ' + FIXED_ORDER.join(', ') + '.' };
  }
  const idxValuation = out.findIndex((s) => s.key === 'valuation');
  const idxRisks = out.findIndex((s) => s.key === 'risks');
  for (let i = 0; i < out.length; i++) {
    if (out[i].key !== 'custom') continue;
    if (i < idxValuation || i > idxRisks) {
      return { error: 'Custom sections must come after Valuation history and before Risks — Risks and Documents always render last.' };
    }
  }

  // 3. Publishing: the required sections must actually say something.
  if (strict) {
    const missing: string[] = [];
    for (const s of out) {
      if ((s.key === 'overview' || s.key === 'strategy' || s.key === 'risks') && isEmptyRichText(s.body)) missing.push(labelFor(s.key));
      if (s.key === 'terms') {
        if (!s.horizon) missing.push('Expected horizon');
        if (!s.valuationFrequency) missing.push('Valuation frequency');
        if (!s.fees) missing.push('Fees');
      }
      if (s.key === 'custom' && (!s.heading || isEmptyRichText(s.body))) missing.push('a custom section\'s heading and body');
    }
    if (missing.length) return { error: 'Cannot publish yet — required before publishing: ' + missing.join(', ') + '.' };
  }
  return { content: { sections: out } };
}

function labelFor(key: string): string {
  return key === 'overview' ? 'Overview' : key === 'strategy' ? 'Strategy' : key === 'risks' ? 'Risks' : key;
}
function capMessage(key: string, len: number): string {
  return labelFor(key) + ' must be at most ' + CAPS[key].toLocaleString('en-US') + ' characters (currently ' + len.toLocaleString('en-US') + ').';
}

// A blank document in canonical form — what the authoring page starts from.
export function emptyDocumentContent(): DocumentContent {
  return {
    sections: [
      { key: 'overview', body: EMPTY_RICH_TEXT },
      { key: 'strategy', body: EMPTY_RICH_TEXT },
      { key: 'terms', horizon: '', valuationFrequency: '', fees: '' },
      { key: 'valuation' },
      { key: 'risks', body: EMPTY_RICH_TEXT },
      { key: 'documents', attachment: null }
    ]
  };
}

export function toDocumentClientShape(row: Record<string, unknown>) {
  return {
    productId: row.product_id,
    status: row.status,
    content: row.content,
    publishedContent: row.published_content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedByEmail: row.updated_by_email,
    publishedAt: row.published_at,
    publishedBy: row.published_by,
    publishedByEmail: row.published_by_email
  };
}
