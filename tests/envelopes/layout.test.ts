import { describe, it, expect } from 'vitest';
import {
  layoutBlock,
  layoutRichBlock,
  defaultReturnLayout,
  defaultRecipientLayout,
  MARGIN_PT,
  LINE_HEIGHT,
  type BlockLayout,
} from '../../src/lib/envelopes/layout';
import type { FaceStyle, RichLine } from '../../src/lib/richtext';

const pageW = 9.5 * 72;
const pageH = 4.125 * 72;
const measure = (t: string) => t.length * 10;
const fontSize = 12;
const lines = ['AAAA', 'BB']; // widths 40, 20; block 40 wide, 30 tall (line height 15)

function layout(overrides: Partial<BlockLayout>): BlockLayout {
  return { ...defaultRecipientLayout(), fontSize, ...overrides };
}

function run(overrides: Partial<BlockLayout>) {
  return layoutBlock({ pageW, pageH, lines, measure, fontSize, layout: layout(overrides) });
}

describe('layout constants', () => {
  it('uses a half-inch margin and 1.25 line height', () => {
    expect(MARGIN_PT).toBe(36);
    expect(LINE_HEIGHT).toBe(1.25);
  });
});

describe('layoutBlock', () => {
  it('reports block width and height', () => {
    const r = run({ anchorH: 'left', anchorV: 'top', align: 'left' });
    expect(r.blockW).toBe(40);
    expect(r.blockH).toBe(30);
  });

  it('places a left/top block at the margins', () => {
    const r = run({ anchorH: 'left', anchorV: 'top', align: 'left' });
    expect(r.lines).toEqual([
      { text: 'AAAA', x: 36, y: pageH - (36 + 12) },
      { text: 'BB', x: 36, y: pageH - (36 + 12 + 15) },
    ]);
  });

  it('centers a center/middle block', () => {
    const r = run({ anchorH: 'center', anchorV: 'middle', align: 'left' });
    const left = (pageW - 40) / 2;
    const top = (pageH - 30) / 2;
    expect(r.lines).toEqual([
      { text: 'AAAA', x: left, y: pageH - (top + 12) },
      { text: 'BB', x: left, y: pageH - (top + 12 + 15) },
    ]);
  });

  it('matches known coordinates for center/middle and right/bottom (684 x 297 pt page)', () => {
    expect(pageW).toBe(684);
    expect(pageH).toBe(297);
    const center = run({ anchorH: 'center', anchorV: 'middle', align: 'left' });
    expect(center.lines[0]).toEqual({ text: 'AAAA', x: 322, y: 151.5 });
    const corner = run({ anchorH: 'right', anchorV: 'bottom', align: 'right' });
    expect(corner.lines[0]).toEqual({ text: 'AAAA', x: 608, y: 54 });
  });

  it('places a right/bottom block against the margins with right-aligned lines', () => {
    const r = run({ anchorH: 'right', anchorV: 'bottom', align: 'right' });
    const left = pageW - 36 - 40;
    const top = pageH - 36 - 30;
    expect(r.lines).toEqual([
      { text: 'AAAA', x: left, y: pageH - (top + 12) },
      { text: 'BB', x: left + 40 - 20, y: pageH - (top + 12 + 15) },
    ]);
  });

  it('centers lines within the block for align center', () => {
    const r = run({ anchorH: 'left', anchorV: 'top', align: 'center' });
    expect(r.lines[0].x).toBe(36);
    expect(r.lines[1].x).toBe(36 + 10);
  });

  it('shifts by 72 pt per inch of offset', () => {
    const base = run({ anchorH: 'left', anchorV: 'top', align: 'left' });
    const moved = run({ anchorH: 'left', anchorV: 'top', align: 'left', offsetX: 1, offsetY: -0.5 });
    expect(moved.lines[0].x).toBe(base.lines[0].x + 72);
    // Block top moves up 36 pt, so the PDF baseline (measured from the bottom) rises by 36.
    expect(moved.lines[0].y).toBe(base.lines[0].y + 36);
    expect(moved.lines[1].y).toBe(base.lines[1].y + 36);
  });

  it('wraps lines wider than the page minus margins', () => {
    const r = layoutBlock({
      pageW,
      pageH,
      lines: ['AAAA BBBB'],
      measure: (t) => t.length * 100,
      fontSize,
      layout: layout({ anchorH: 'left', anchorV: 'top', align: 'left' }),
    });
    expect(r.lines.map((l) => l.text)).toEqual(['AAAA', 'BBBB']);
  });
});

describe('layoutRichBlock', () => {
  // At 12 pt, plain characters are 10 pt wide and bold ones 12 pt; widths scale with size.
  const richMeasure = (t: string, size: number, style: FaceStyle) => [...t].length * (style.bold ? 12 : 10) * (size / 12);
  const plain: FaceStyle = { bold: false, italic: false };
  const bold: FaceStyle = { bold: true, italic: false };

  function rich(lines: RichLine[], overrides: Partial<BlockLayout> = {}) {
    return layoutRichBlock({
      pageW,
      pageH,
      lines,
      measure: richMeasure,
      layout: layout({ anchorH: 'left', anchorV: 'top', align: 'left', ...overrides }),
    });
  }

  it('places plain single-run lines at known coordinates for each anchor (684 x 297 pt page)', () => {
    // Block is 40 x 30 pt (lines 40 and 20 wide, 15 pt line height); baselines sit 12 pt below each line top.
    const cases: { anchor: Partial<BlockLayout>; expected: { text: string; x: number; y: number }[] }[] = [
      {
        // left = 36, top = 36
        anchor: { anchorH: 'left', anchorV: 'top', align: 'left' },
        expected: [
          { text: 'AAAA', x: 36, y: 249 },
          { text: 'BB', x: 36, y: 234 },
        ],
      },
      {
        // left = (684 - 40) / 2 = 322, top = (297 - 30) / 2 = 133.5; BB centered 10 pt in
        anchor: { anchorH: 'center', anchorV: 'middle', align: 'center' },
        expected: [
          { text: 'AAAA', x: 322, y: 151.5 },
          { text: 'BB', x: 332, y: 136.5 },
        ],
      },
      {
        // left = 684 - 36 - 40 + 36 = 644, top = 297 - 36 - 30 - 18 = 213; BB right-aligned 20 pt in
        anchor: { anchorH: 'right', anchorV: 'bottom', align: 'right', offsetX: 0.5, offsetY: -0.25 },
        expected: [
          { text: 'AAAA', x: 644, y: 72 },
          { text: 'BB', x: 664, y: 57 },
        ],
      },
    ];
    for (const { anchor, expected } of cases) {
      const r = rich([{ runs: [{ text: 'AAAA' }] }, { runs: [{ text: 'BB' }] }], anchor);
      expect(r.blockW).toBe(40);
      expect(r.blockH).toBe(30);
      expect(r.lines.map((l) => ({ text: l.runs.map((x) => x.text).join(''), x: l.x, y: l.y }))).toEqual(expected);
    }
  });

  it('gives a 24 pt line a 30 pt advance', () => {
    const r = rich([
      { runs: [{ text: 'A' }], size: 24 },
      { runs: [{ text: 'B' }], size: 24 },
    ]);
    expect(r.lines[0].y - r.lines[1].y).toBe(30);
    expect(r.blockH).toBe(60);
  });

  it('places each baseline by its own size inside its own line box', () => {
    const r = rich([
      { runs: [{ text: 'A' }] },
      { runs: [{ text: 'B' }], size: 24 },
      { runs: [{ text: 'C' }] },
    ]);
    // Line boxes are 15, 30, and 15 tall; each baseline sits its own size below its box top.
    expect(r.lines.map((l) => l.y)).toEqual([pageH - (36 + 12), pageH - (36 + 15 + 24), pageH - (36 + 45 + 12)]);
    expect(r.lines.map((l) => l.size)).toEqual([12, 24, 12]);
    expect(r.blockH).toBe(60);
  });

  it('uses the block font size when a line has none', () => {
    const r = rich([{ runs: [{ text: 'A' }] }], { fontSize: 10 });
    expect(r.lines[0].size).toBe(10);
    expect(r.lines[0].y).toBe(pageH - (36 + 10));
    expect(r.blockH).toBe(12.5);
  });

  it('positions mixed runs contiguously and reports the line width', () => {
    const r = rich([{ runs: [{ text: 'Jane ' }, { text: 'Doe', bold: true }] }]);
    expect(r.lines[0]).toEqual({
      x: 36,
      y: pageH - 48,
      width: 86,
      size: 12,
      runs: [
        { text: 'Jane ', x: 36, style: plain },
        { text: 'Doe', x: 86, style: bold },
      ],
    });
  });

  it('measures runs at the line size', () => {
    const r = rich([{ runs: [{ text: 'Jane ' }, { text: 'Doe', bold: true }], size: 24 }]);
    expect(r.lines[0].width).toBe(172);
    expect(r.lines[0].runs[1].x).toBe(36 + 100);
  });

  it('centers lines with mixed runs using the full line width', () => {
    const r = rich(
      [
        { runs: [{ text: 'Jane ' }, { text: 'Doe', bold: true }] },
        { runs: [{ text: 'X', italic: true }] },
      ],
      { anchorH: 'center', align: 'center' },
    );
    const left = (pageW - 86) / 2;
    expect(r.blockW).toBe(86);
    expect(r.lines[0].x).toBe(left);
    expect(r.lines[0].runs.map((x) => x.x)).toEqual([left, left + 50]);
    expect(r.lines[1].x).toBe(left + (86 - 10) / 2);
    expect(r.lines[1].runs).toEqual([{ text: 'X', x: left + 38, style: { bold: false, italic: true } }]);
  });

  it('right-aligns lines with mixed runs', () => {
    const r = rich(
      [
        { runs: [{ text: 'Jane ' }, { text: 'Doe', bold: true }] },
        { runs: [{ text: 'X' }] },
      ],
      { align: 'right' },
    );
    expect(r.lines[1].x).toBe(36 + 86 - 10);
  });

  it('wraps by word across runs, keeping styles, and each wrapped piece keeps the line size', () => {
    const r = layoutRichBlock({
      pageW,
      pageH,
      lines: [{ runs: [{ text: 'AAAA ' }, { text: 'BBBB', bold: true }], size: 24 }],
      measure: (t, size) => [...t].length * size * 5,
      layout: layout({ anchorH: 'left', anchorV: 'top', align: 'left' }),
    });
    expect(r.lines.map((l) => l.runs)).toEqual([
      [{ text: 'AAAA', x: 36, style: plain }],
      [{ text: 'BBBB', x: 36, style: bold }],
    ]);
    expect(r.lines.map((l) => l.size)).toEqual([24, 24]);
    expect(r.lines[0].y - r.lines[1].y).toBe(30);
  });

  it('keeps an empty line as vertical space', () => {
    const r = rich([{ runs: [{ text: 'A' }] }, { runs: [] }, { runs: [{ text: 'B' }] }]);
    expect(r.lines[1]).toEqual({ x: 36, y: pageH - (36 + 15 + 12), width: 0, size: 12, runs: [] });
    expect(r.lines[2].y).toBe(pageH - (36 + 30 + 12));
    expect(r.blockH).toBe(45);
  });

  it('reports an empty block for no lines', () => {
    const r = rich([]);
    expect(r).toEqual({ lines: [], blockW: 0, blockH: 0 });
  });
});

describe('default layouts', () => {
  it('puts the return address at top left in 10 pt Helvetica', () => {
    expect(defaultReturnLayout()).toEqual({
      font: { kind: 'standard', id: 'helvetica' },
      fontSize: 10,
      align: 'left',
      anchorH: 'left',
      anchorV: 'top',
      offsetX: 0,
      offsetY: 0,
    });
  });

  it('centers the recipient in 12 pt Helvetica', () => {
    expect(defaultRecipientLayout()).toEqual({
      font: { kind: 'standard', id: 'helvetica' },
      fontSize: 12,
      align: 'left',
      anchorH: 'center',
      anchorV: 'middle',
      offsetX: 0,
      offsetY: 0,
    });
  });

  it('returns fresh objects each call', () => {
    expect(defaultReturnLayout()).not.toBe(defaultReturnLayout());
    expect(defaultRecipientLayout().font).not.toBe(defaultRecipientLayout().font);
  });
});
