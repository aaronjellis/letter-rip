/**
 * Line bookkeeping for the address editor's contenteditable root, whose children are one `<div>`
 * per line (see `richToHtml`). Pure functions over DOM nodes; they never read the page's globals,
 * so they run in any DOM implementation.
 */

const TEXT_NODE = 3;

/** Indices of the first and last line divs a selection touches. */
export type LineSpan = { start: number; end: number };

function isLine(n: Node): n is HTMLElement {
  return n.nodeName === 'DIV';
}

/**
 * Index of the line div that holds a boundary point. A point directly in `root` sits between
 * lines: as a range start it belongs to the line after it, as a range end to the line before it.
 */
export function lineIndex(root: HTMLElement, node: Node, offset: number, isEnd: boolean): number {
  const kids = root.childNodes;
  if (node === root) return Math.max(0, Math.min(isEnd ? offset - 1 : offset, kids.length - 1));
  let n: Node = node;
  while (n.parentNode && n.parentNode !== root) n = n.parentNode;
  return Math.max(0, Array.prototype.indexOf.call(kids, n));
}

/**
 * The lines a range touches. A non-collapsed range that ends at the very start of a line (as a
 * triple-click selects) does not touch that line.
 */
export function touchedLines(root: HTMLElement, range: Range): LineSpan {
  const start = lineIndex(root, range.startContainer, range.startOffset, false);
  let end = lineIndex(root, range.endContainer, range.endOffset, true);
  if (!range.collapsed && end > start && range.endContainer !== root) {
    const before = range.cloneRange();
    before.setStart(root.childNodes[end], 0);
    before.setEnd(range.endContainer, range.endOffset);
    if (before.toString() === '') end--;
  }
  return { start, end };
}

/**
 * Keep one div per line: wrap stray top-level text and inline nodes (which browsers create when
 * the editor was empty) in divs. Whitespace-only text between lines is markup formatting and is
 * removed. When `selection` lies inside `root`, it is put back where it was.
 */
export function ensureLines(root: HTMLElement, selection?: Selection | null): void {
  const nodes = Array.from(root.childNodes);
  if (nodes.every(isLine)) return;
  const sel = selection && selection.anchorNode && selection.focusNode
    && root.contains(selection.anchorNode) && root.contains(selection.focusNode)
    && selection.anchorNode !== root && selection.focusNode !== root
    ? selection
    : null;
  const keep = sel ? { a: sel.anchorNode!, ao: sel.anchorOffset, f: sel.focusNode!, fo: sel.focusOffset } : null;
  const doc = root.ownerDocument;
  let line: HTMLElement | null = null;
  for (const n of nodes) {
    if (isLine(n)) {
      line = null;
      continue;
    }
    if (!line && n.nodeType === TEXT_NODE && (n.textContent ?? '').trim() === '' && n !== keep?.a && n !== keep?.f) {
      n.remove();
      continue;
    }
    if (!line) {
      line = doc.createElement('div');
      root.insertBefore(line, n);
    }
    line.appendChild(n);
    if (n.nodeName === 'BR') line = null;
  }
  if (sel && keep && root.contains(keep.a) && root.contains(keep.f)) sel.setBaseAndExtent(keep.a, keep.ao, keep.f, keep.fo);
}

/** A line div's size override from `data-size`, or null when it has none. */
export function lineSize(line: Node | undefined | null): number | null {
  if (!line || !isLine(line)) return null;
  const raw = line.dataset.size;
  if (raw === undefined || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** The size of the first line in `span`: its override, else `blockSize`. */
export function firstLineSize(root: HTMLElement, span: LineSpan, blockSize: number): number {
  return lineSize(root.childNodes[span.start]) ?? blockSize;
}

/** True when the lines in `span` do not all have the same size (a missing override is `blockSize`). */
export function hasMixedSizes(root: HTMLElement, span: LineSpan, blockSize: number): boolean {
  const kids = root.childNodes;
  const first = firstLineSize(root, span, blockSize);
  for (let i = span.start + 1; i <= span.end && i < kids.length; i++) {
    if ((lineSize(kids[i]) ?? blockSize) !== first) return true;
  }
  return false;
}
