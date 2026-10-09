/**
 * Rich text for address blocks: lines of styled runs with an optional per-line size.
 * Pure functions only; the HTML mapping uses a small hand-written tokenizer so it runs in Node.
 */
import { RAW_TEXT, tokenize } from './html-tokenize';

export type TextRun = { text: string; bold?: boolean; italic?: boolean };
/** `size` is in points and overrides the block's default font size. */
export type RichLine = { runs: TextRun[]; size?: number };
export type RichText = { lines: RichLine[] };

export type FaceStyle = { bold: boolean; italic: boolean };

export const MIN_LINE_SIZE = 6;
export const MAX_LINE_SIZE = 72;

/** The face a run needs, with both flags filled in. */
export function runStyle(run: TextRun): FaceStyle {
  return { bold: !!run.bold, italic: !!run.italic };
}

/** True when two runs use the same face (a missing flag equals false). */
export function sameStyle(a: TextRun, b: TextRun): boolean {
  return !!a.bold === !!b.bold && !!a.italic === !!b.italic;
}

/** A run with only true style flags present. */
function makeRun(text: string, style: { bold?: boolean; italic?: boolean }): TextRun {
  const run: TextRun = { text };
  if (style.bold) run.bold = true;
  if (style.italic) run.italic = true;
  return run;
}

/**
 * Concatenate run lists into one, merging neighbors with equal style and dropping empty runs.
 * Returns fresh runs with only true style flags; the inputs are not changed.
 */
export function mergeRuns(...parts: TextRun[][]): TextRun[] {
  const out: TextRun[] = [];
  for (const part of parts) {
    for (const r of part) {
      if (r.text === '') continue;
      const last = out[out.length - 1];
      if (last && sameStyle(last, r)) last.text += r.text;
      else out.push(makeRun(r.text, r));
    }
  }
  return out;
}

/** Append text to a run list, extending the last run when the style matches. Mutates `runs`. */
function appendText(runs: TextRun[], text: string, style: { bold?: boolean; italic?: boolean }): void {
  if (text === '') return;
  const last = runs[runs.length - 1];
  if (last && !!last.bold === !!style.bold && !!last.italic === !!style.italic) last.text += text;
  else runs.push(makeRun(text, style));
}

function clampSize(size: unknown): number | undefined {
  if (typeof size !== 'number' || !Number.isFinite(size)) return undefined;
  return Math.min(MAX_LINE_SIZE, Math.max(MIN_LINE_SIZE, size));
}

function makeLine(runs: TextRun[], size: number | undefined): RichLine {
  return size === undefined ? { runs } : { runs, size };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseRun(v: unknown): TextRun | null {
  if (!isObj(v) || typeof v.text !== 'string') return null;
  if (v.bold !== undefined && typeof v.bold !== 'boolean') return null;
  if (v.italic !== undefined && typeof v.italic !== 'boolean') return null;
  return makeRun(v.text, { bold: v.bold, italic: v.italic });
}

function parseRichLine(v: unknown): RichLine | null {
  if (!isObj(v) || !Array.isArray(v.runs)) return null;
  return makeLine(v.runs.map(parseRun).filter((r): r is TextRun => r !== null), clampSize(v.size));
}

/**
 * Validate rich text from a file: an object with a `lines` array of `{ runs, size? }`, where each run
 * is `{ text: string, bold?: boolean, italic?: boolean }`. Invalid lines and runs are dropped, sizes
 * are clamped to 6–72 (non-numbers are dropped), false flags and unknown keys are removed, and
 * anything that is not rich text at all becomes empty rich text.
 */
export function parseRichText(input: unknown): RichText {
  if (!isObj(input) || !Array.isArray(input.lines)) return { lines: [] };
  return { lines: input.lines.map(parseRichLine).filter((l): l is RichLine => l !== null) };
}

/** One line per input line, each with a single unstyled run (or none when blank). Keeps blank lines. */
export function plainToRich(text: string): RichText {
  return { lines: text.split(/\r\n?|\n/).map((l) => ({ runs: l === '' ? [] : [{ text: l }] })) };
}

/** Lines of run text joined with newlines. */
export function richToPlain(rich: RichText): string {
  return rich.lines.map((l) => l.runs.map((r) => r.text).join('')).join('\n');
}

/** True when there are no lines or every run is whitespace. */
export function isRichEmpty(rich: RichText): boolean {
  return rich.lines.every((l) => l.runs.every((r) => r.text.trim() === ''));
}

/**
 * Canonical form: merges adjacent runs with equal style, drops empty runs and false style flags,
 * trims each line's outer whitespace, clamps sizes to 6–72 (dropping non-numbers), and drops
 * leading and trailing empty lines. Interior empty lines stay. Returns a new value.
 */
export function normalizeRich(rich: RichText): RichText {
  const lines = rich.lines.map((line) => {
    const runs = mergeRuns(line.runs);
    while (runs.length > 0) {
      const t = runs[0].text.trimStart();
      if (t !== '') {
        runs[0].text = t;
        break;
      }
      runs.shift();
    }
    while (runs.length > 0) {
      const last = runs[runs.length - 1];
      const t = last.text.trimEnd();
      if (t !== '') {
        last.text = t;
        break;
      }
      runs.pop();
    }
    return makeLine(runs, clampSize(line.size));
  });
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].runs.length === 0) start++;
  while (end > start && lines[end - 1].runs.length === 0) end--;
  return { lines: lines.slice(start, end) };
}

// ---------------------------------------------------------------------------------------------
// HTML mapping

const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

const BLOCK = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'caption', 'center', 'dd', 'details', 'dialog', 'div', 'dl',
  'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup',
  'hr', 'html', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'tbody', 'tfoot', 'thead', 'tr',
  'ul',
]);

/** Elements whose content never shows as text. */
const HIDDEN = new Set(['head', 'template', 'svg', 'math', 'select', 'object', 'xml', 'datalist']);

/** Cells separate their text with a space rather than a line break. */
const CELL = new Set(['td', 'th']);

type Context = { name: string; bold: boolean; italic: boolean; size: number | undefined; hidden: boolean };

/** Open elements nested deeper than this are unwrapped: their tags are ignored and their text kept. */
const MAX_DEPTH = 512;

/** Index of the innermost open element named `name`, or -1. The root context never matches. */
function findOpen(stack: Context[], name: string): number {
  for (let at = stack.length - 1; at > 0; at--) if (stack[at].name === name) return at;
  return -1;
}

/** Read bold and italic from an inline style attribute; undefined means "not set". */
function styleFlags(style: string | undefined): { bold?: boolean; italic?: boolean; ignore?: boolean } {
  const out: { bold?: boolean; italic?: boolean; ignore?: boolean } = {};
  if (!style) return out;
  for (const decl of style.split(';')) {
    const colon = decl.indexOf(':');
    if (colon === -1) continue;
    const prop = decl.slice(0, colon).trim().toLowerCase();
    const value = decl.slice(colon + 1).trim().toLowerCase().replace(/\s*!important$/, '');
    if (prop === 'font-weight') {
      if (value === 'bold' || value === 'bolder') out.bold = true;
      else if (value === 'normal' || value === 'lighter') out.bold = false;
      else if (/^\d+$/.test(value)) out.bold = Number(value) >= 600;
    } else if (prop === 'font-style') {
      if (value.startsWith('italic') || value.startsWith('oblique')) out.italic = true;
      else if (value === 'normal') out.italic = false;
    } else if (prop === 'mso-list' && value === 'ignore') {
      // Word's generated list bullets and numbers.
      out.ignore = true;
    }
  }
  return out;
}

const isCollapsible = (ch: string) => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f';

/**
 * Parse HTML into rich text. Block elements (div, p, li, …) and `<br>` make lines; `<b>`, `<strong>`,
 * `<i>`, `<em>`, and inline font-weight/font-style make styles; `data-size` sets a line's size.
 * Other tags are unwrapped. Whitespace collapses as a browser would; `&nbsp;` becomes a space that
 * does not collapse. Runs are merged, but lines are not trimmed and empty lines are kept
 * (see normalizeRich).
 *
 * With `fragment`, the input is an inline piece of a line (such as a paste at the caret): whitespace
 * at the very start and very end of the input is kept as one space each, unless a line break or block
 * boundary separates it from the text.
 */
export function htmlToRich(html: string, options: { fragment?: boolean } = {}): RichText {
  const lines: RichLine[] = [];
  const stack: Context[] = [{ name: '', bold: false, italic: false, size: undefined, hidden: false }];
  const top = () => stack[stack.length - 1];

  let runs: TextRun[] = [];
  let lineSize: number | undefined | null = null; // null: not yet decided for this line
  let pending: { bold: boolean; italic: boolean } | null = null; // a collapsed space waiting for content
  let hasContent = false;
  let atFragmentStart = !!options.fragment; // no line has started or ended yet

  const resetLine = () => {
    runs = [];
    lineSize = null;
    pending = null;
    hasContent = false;
    atFragmentStart = false;
  };
  const pushLine = () => {
    lines.push(makeLine(runs, lineSize ?? undefined));
    resetLine();
  };
  /** At a block boundary: end the current line if it has content, otherwise discard stray whitespace. */
  const breakBlock = () => {
    if (hasContent) pushLine();
    else resetLine();
  };

  const addText = (text: string) => {
    const ctx = top();
    if (ctx.hidden) return;
    for (const ch of text) {
      if (isCollapsible(ch)) {
        if ((hasContent || atFragmentStart) && pending === null) pending = { bold: ctx.bold, italic: ctx.italic };
        continue;
      }
      if (lineSize === null) lineSize = ctx.size;
      if (pending) {
        appendText(runs, ' ', pending);
        pending = null;
      }
      appendText(runs, ch === '\u00a0' ? ' ' : ch, ctx);
      hasContent = true;
    }
  };

  for (const tok of tokenize(html)) {
    if (tok.type === 'text') {
      addText(tok.text);
      continue;
    }

    if (tok.type === 'end') {
      if (tok.name === 'br') {
        // Browsers treat </br> as <br>.
        if (!top().hidden) {
          if (lineSize === null) lineSize = top().size;
          pushLine();
        }
        continue;
      }
      const at = findOpen(stack, tok.name);
      if (at === -1) continue;
      const closed = stack.splice(at).filter((c) => !c.hidden);
      if (top().hidden) continue;
      if (closed.some((c) => BLOCK.has(c.name))) breakBlock();
      else if (closed.some((c) => CELL.has(c.name)) && hasContent && pending === null) {
        pending = { bold: false, italic: false };
      }
      continue;
    }

    const parent = top();
    const name = tok.name;
    if (name === 'br') {
      if (!parent.hidden) {
        if (lineSize === null) lineSize = parent.size;
        pushLine();
      }
      continue;
    }
    if (!parent.hidden && BLOCK.has(name)) breakBlock();
    if (VOID.has(name) || tok.selfClosing) continue;

    const flags = styleFlags(tok.attrs.style);
    let bold = parent.bold;
    let italic = parent.italic;
    if (name === 'b' || name === 'strong') bold = true;
    if (name === 'i' || name === 'em') italic = true;
    if (flags.bold !== undefined) bold = flags.bold;
    if (flags.italic !== undefined) italic = flags.italic;
    let size = parent.size;
    if (tok.attrs['data-size'] !== undefined && tok.attrs['data-size'].trim() !== '') {
      size = clampSize(Number(tok.attrs['data-size'])) ?? size;
    }
    const hidden = parent.hidden || HIDDEN.has(name) || RAW_TEXT.has(name) || !!flags.ignore;
    if (stack.length < MAX_DEPTH) stack.push({ name, bold, italic, size, hidden });
  }
  if (hasContent) {
    if (options.fragment && pending) appendText(runs, ' ', pending);
    pushLine();
  }
  return { lines };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Inline HTML for one line's runs. Spaces a browser would collapse (at either end of the line,
 * or after another space) become `&nbsp;` so the line reads back unchanged.
 */
function runsToHtml(runs: TextRun[]): string {
  const total = runs.reduce((n, r) => n + r.text.length, 0);
  let index = 0;
  let prev = '';
  let out = '';
  for (const r of runs) {
    let body = '';
    for (const ch of r.text) {
      const atEdge = index === 0 || index + ch.length === total;
      body += ch === ' ' && (atEdge || prev === ' ') ? '&nbsp;' : escapeHtml(ch);
      prev = ch;
      index += ch.length;
    }
    if (r.italic) body = `<i>${body}</i>`;
    if (r.bold) body = `<b>${body}</b>`;
    out += body;
  }
  return out;
}

/**
 * The editor's DOM contract: one `<div>` per line, runs as text optionally wrapped in `<b>` and `<i>`,
 * a size override as `data-size` plus a matching inline font-size, and `<br>` in empty lines.
 */
export function richToHtml(rich: RichText): string {
  return rich.lines
    .map((line) => {
      // Clamped here too, so a malformed size can never reach the markup.
      const size = clampSize(line.size);
      const attrs = size === undefined ? '' : ` data-size="${size}" style="font-size:${size}pt"`;
      const body = line.runs.length === 0 ? '<br>' : runsToHtml(line.runs);
      return `<div${attrs}>${body}</div>`;
    })
    .join('');
}

/** Lines as inline HTML separated by `<br>`, without sizes; for inserting at a caret. */
export function richToInlineHtml(rich: RichText): string {
  return rich.lines.map((l) => runsToHtml(l.runs)).join('<br>');
}
