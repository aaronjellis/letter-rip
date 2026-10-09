import type { FontRef } from '../fonts/types';
import { wrapRuns } from '../pdf/text';
import { runStyle, type FaceStyle, type RichLine } from '../richtext';

export type HAnchor = 'left' | 'center' | 'right';
export type VAnchor = 'top' | 'middle' | 'bottom';

export type BlockLayout = {
  font: FontRef;
  fontSize: number; // points, 6–72
  align: HAnchor; // text alignment of lines within the block
  anchorH: HAnchor;
  anchorV: VAnchor;
  offsetX: number; // inches, positive moves right
  offsetY: number; // inches, positive moves down
};

const PT_PER_IN = 72;
export const MARGIN_PT = 0.5 * PT_PER_IN;
export const LINE_HEIGHT = 1.25;

export function defaultReturnLayout(): BlockLayout {
  return {
    font: { kind: 'standard', id: 'helvetica' },
    fontSize: 10,
    align: 'left',
    anchorH: 'left',
    anchorV: 'top',
    offsetX: 0,
    offsetY: 0,
  };
}

export function defaultRecipientLayout(): BlockLayout {
  return {
    font: { kind: 'standard', id: 'helvetica' },
    fontSize: 12,
    align: 'left',
    anchorH: 'center',
    anchorV: 'middle',
    offsetX: 0,
    offsetY: 0,
  };
}

export type PlacedRun = { text: string; x: number; style: FaceStyle };
/** A laid-out line: `x` is its left edge, `y` its baseline, `size` its font size in points. */
export type PlacedRichLine = { x: number; y: number; width: number; size: number; runs: PlacedRun[] };

/**
 * Place a block of rich lines on a page. Coordinates are PDF points with the origin at the bottom
 * left; each y is a text baseline. Each line's size is `line.size ?? layout.fontSize` and its line
 * box is 1.25 × that size tall, with the baseline one size below the box top. Lines wrap at the page
 * width minus margins, keeping each word's style; wrapped pieces keep the line's size. Runs are
 * measured in their own face at the line's size and placed side by side. No clamping: offsets may
 * push text off the page.
 */
export function layoutRichBlock(input: {
  pageW: number;
  pageH: number;
  lines: RichLine[];
  measure: (text: string, size: number, style: FaceStyle) => number;
  layout: BlockLayout;
}): { lines: PlacedRichLine[]; blockW: number; blockH: number } {
  const { pageW, pageH, lines, measure, layout } = input;

  const maxWidth = pageW - 2 * MARGIN_PT;
  const wrapped = lines.flatMap((line) => {
    const size = line.size ?? layout.fontSize;
    return wrapRuns(line.runs, (r) => measure(r.text, size, runStyle(r)), maxWidth).map((runs) => {
      const widths = runs.map((r) => measure(r.text, size, runStyle(r)));
      return { size, runs, widths, width: widths.reduce((a, b) => a + b, 0) };
    });
  });
  const blockW = wrapped.length > 0 ? Math.max(...wrapped.map((l) => l.width)) : 0;
  const blockH = wrapped.reduce((h, l) => h + l.size * LINE_HEIGHT, 0);

  const left =
    (layout.anchorH === 'left'
      ? MARGIN_PT
      : layout.anchorH === 'center'
        ? (pageW - blockW) / 2
        : pageW - MARGIN_PT - blockW) +
    layout.offsetX * PT_PER_IN;

  const top =
    (layout.anchorV === 'top'
      ? MARGIN_PT
      : layout.anchorV === 'middle'
        ? (pageH - blockH) / 2
        : pageH - MARGIN_PT - blockH) +
    layout.offsetY * PT_PER_IN;

  let boxTop = top;
  const placed = wrapped.map(({ size, runs, widths, width }) => {
    const x =
      layout.align === 'left'
        ? left
        : layout.align === 'center'
          ? left + (blockW - width) / 2
          : left + blockW - width;
    const y = pageH - (boxTop + size);
    boxTop += size * LINE_HEIGHT;
    let runX = x;
    const placedRuns = runs.map((r, i) => {
      const p = { text: r.text, x: runX, style: runStyle(r) };
      runX += widths[i];
      return p;
    });
    return { x, y, width, size, runs: placedRuns };
  });

  return { lines: placed, blockW, blockH };
}

export type PlacedLine = { text: string; x: number; y: number };

/**
 * Plain-text form of layoutRichBlock: each string is one unstyled line at `fontSize`.
 * Kept for callers that have not moved to rich text yet.
 */
export function layoutBlock(input: {
  pageW: number;
  pageH: number;
  lines: string[];
  measure: (text: string) => number;
  fontSize: number;
  layout: BlockLayout;
}): { lines: PlacedLine[]; blockW: number; blockH: number } {
  const { pageW, pageH, lines, measure, fontSize, layout } = input;
  const r = layoutRichBlock({
    pageW,
    pageH,
    lines: lines.map((text) => ({ runs: text === '' ? [] : [{ text }] })),
    measure: (text) => measure(text),
    layout: { ...layout, fontSize },
  });
  return {
    lines: r.lines.map((l) => ({ text: l.runs.map((x) => x.text).join(''), x: l.x, y: l.y })),
    blockW: r.blockW,
    blockH: r.blockH,
  };
}
