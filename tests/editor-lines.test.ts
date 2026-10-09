// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  ensureLines, firstLineSize, hasMixedSizes, lineIndex, lineSize, touchedLines,
} from '../src/lib/editor-lines';

function editor(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.replaceChildren(root);
  return root;
}

function textIn(el: Node): Text {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  return walker.nextNode() as Text;
}

describe('lineIndex', () => {
  it('finds the line of a text node nested in bold and italic', () => {
    const root = editor('<div>Jane</div><div>1 <b><i>Main</i></b> St</div><div>Town</div>');
    const main = textIn(root.querySelector('i')!);
    expect(lineIndex(root, main, 2, false)).toBe(1);
    expect(lineIndex(root, main, 2, true)).toBe(1);
  });

  it('maps a point directly in the root to the line after (start) or before (end) it', () => {
    const root = editor('<div>a</div><div>b</div><div>c</div>');
    expect(lineIndex(root, root, 1, false)).toBe(1);
    expect(lineIndex(root, root, 1, true)).toBe(0);
    expect(lineIndex(root, root, 3, true)).toBe(2);
    expect(lineIndex(root, root, 0, true)).toBe(0);
  });
});

describe('touchedLines', () => {
  it('trims a selection that ends at the start of the next line to the previous line', () => {
    const root = editor('<div>Jane Doe</div><div>Main St</div><div>Town</div>');
    const range = document.createRange();
    range.setStart(textIn(root.children[0]), 0);
    range.setEnd(textIn(root.children[1]), 0);
    expect(touchedLines(root, range)).toEqual({ start: 0, end: 0 });
  });

  it('keeps the last line when the selection includes some of its text', () => {
    const root = editor('<div>Jane Doe</div><div>Main St</div>');
    const range = document.createRange();
    range.setStart(textIn(root.children[0]), 2);
    range.setEnd(textIn(root.children[1]), 1);
    expect(touchedLines(root, range)).toEqual({ start: 0, end: 1 });
  });

  it('reports a caret as a single line', () => {
    const root = editor('<div>Jane</div><div>Main <b>St</b></div>');
    const range = document.createRange();
    range.setStart(textIn(root.querySelector('b')!), 1);
    range.collapse(true);
    expect(touchedLines(root, range)).toEqual({ start: 1, end: 1 });
  });
});

describe('ensureLines', () => {
  it('wraps bare top-level text and inline nodes in line divs', () => {
    const root = editor('');
    root.append(document.createTextNode('Jane '), Object.assign(document.createElement('b'), { textContent: 'Doe' }));
    root.append(document.createElement('br'), document.createTextNode('Main St'));
    ensureLines(root);
    expect(root.innerHTML).toBe('<div>Jane <b>Doe</b><br></div><div>Main St</div>');
  });

  it('leaves existing line divs alone and drops whitespace between them', () => {
    const root = editor('<div>a</div>\n  <div>b</div>');
    ensureLines(root);
    expect(root.innerHTML).toBe('<div>a</div><div>b</div>');
  });

  it('keeps the selection on the wrapped text', () => {
    const root = editor('');
    const text = document.createTextNode('Jane');
    root.append(text);
    const sel = document.getSelection()!;
    sel.setBaseAndExtent(text, 2, text, 2);
    ensureLines(root, sel);
    expect(root.innerHTML).toBe('<div>Jane</div>');
    expect(sel.anchorNode).toBe(text);
    expect(sel.anchorOffset).toBe(2);
  });
});

describe('line sizes', () => {
  it('reads data-size overrides and ignores missing or invalid ones', () => {
    const root = editor('<div data-size="18">a</div><div>b</div><div data-size="x">c</div>');
    expect(lineSize(root.children[0])).toBe(18);
    expect(lineSize(root.children[1])).toBeNull();
    expect(lineSize(root.children[2])).toBeNull();
    expect(lineSize(undefined)).toBeNull();
  });

  it('detects mixed sizes across lines with and without data-size', () => {
    const root = editor('<div data-size="18">a</div><div>b</div><div data-size="12">c</div>');
    expect(hasMixedSizes(root, { start: 0, end: 1 }, 12)).toBe(true);
    expect(hasMixedSizes(root, { start: 1, end: 2 }, 12)).toBe(false);
    expect(hasMixedSizes(root, { start: 1, end: 2 }, 14)).toBe(true);
    expect(hasMixedSizes(root, { start: 0, end: 0 }, 12)).toBe(false);
  });

  it('gives the first line size, falling back to the block size', () => {
    const root = editor('<div data-size="18">a</div><div>b</div>');
    expect(firstLineSize(root, { start: 0, end: 1 }, 12)).toBe(18);
    expect(firstLineSize(root, { start: 1, end: 1 }, 12)).toBe(12);
  });
});
