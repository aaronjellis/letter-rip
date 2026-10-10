/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PDFArray, PDFDocument, PDFDict, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { buildEnvelopePdf, pageSizeFor, rotatePoint, type EnvelopeSettings, type Rotation } from '../../src/lib/envelopes/build';
import { defaultRecipientLayout, defaultReturnLayout } from '../../src/lib/envelopes/layout';
import type { AvailableFaces, FaceStyle, FontProvider, FontRef } from '../../src/lib/fonts/types';
import { plainToRich, type RichText } from '../../src/lib/richtext';

const fontFile = (path: string) => new Uint8Array(readFileSync(resolve(__dirname, '../../public/fonts', path)));
const latoBytes = fontFile('lato/Lato-Regular.ttf');
const latoBoldBytes = fontFile('lato/Lato-Bold.ttf');
const greatVibesBytes = fontFile('great-vibes/GreatVibes-Regular.ttf');
/** Lobster stores glyphs unpadded, which corrupts its subset unless they are padded first. */
const lobsterBytes = new Uint8Array(readFileSync(resolve(__dirname, '../fixtures/Lobster-Regular.ttf')));
const LOBSTER: FontRef = { kind: 'google', family: 'Lobster' };
const LATO: FontRef = { kind: 'bundled', id: 'lato', family: 'Lato' };
const GREAT_VIBES: FontRef = { kind: 'bundled', id: 'great-vibes', family: 'Great Vibes' };

const NO_FACES: AvailableFaces = { bold: false, italic: false, boldItalic: false };
const isRegular = (s: FaceStyle) => !s.bold && !s.italic;

/** Lato has Regular and Bold here; Great Vibes has only Regular. Asking for any other face throws. */
const fixtureProvider: FontProvider = {
  async availableFaces(ref) {
    if (ref.kind === 'standard') return { bold: true, italic: true, boldItalic: true };
    if (ref.kind === 'bundled' && ref.id === 'lato') return { bold: true, italic: false, boldItalic: false };
    return NO_FACES;
  },
  async getBytes(ref, style) {
    if (ref.kind === 'standard') return null;
    if (ref.kind === 'bundled' && ref.id === 'lato') {
      if (isRegular(style)) return latoBytes;
      if (style.bold && !style.italic) return latoBoldBytes;
    }
    if (ref.kind === 'bundled' && ref.id === 'great-vibes' && isRegular(style)) return greatVibesBytes;
    throw new Error(`No fixture for ${JSON.stringify(ref)} ${JSON.stringify(style)}`);
  },
};

const settings: EnvelopeSettings = {
  size: 'num10',
  customWidthIn: 7,
  customHeightIn: 5,
  showReturn: true,
  showRecipient: true,
  returnAddress: plainToRich('First Church\n1 Chapel Rd\nSpringfield, IL 62701'),
  returnLayout: defaultReturnLayout(),
  recipientLayout: defaultRecipientLayout(),
  paper: { kind: 'envelope', position: 'center' },
  rotation: 0,
};

const rich = (...lines: string[]): RichText => plainToRich(lines.join('\n'));

/** BaseFont names of the PDF's font dictionaries, such as `/Helvetica-Bold`. */
async function baseFonts(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.context.enumerateIndirectObjects()
    .map(([, obj]) => obj)
    .filter((o): o is PDFDict => o instanceof PDFDict && o.get(PDFName.of('Type')) === PDFName.of('Font'))
    .map((d) => String(d.get(PDFName.of('BaseFont'))));
}

/** FontName of every embedded font descriptor; pdf-lib names subsets like `/Lato-Bold-9750`. */
async function descriptorNames(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.context.enumerateIndirectObjects()
    .map(([, obj]) => obj)
    .filter((o): o is PDFDict => o instanceof PDFDict && o.get(PDFName.of('Type')) === PDFName.of('FontDescriptor'))
    .map((d) => String(d.get(PDFName.of('FontName'))));
}

/** Every embedded TrueType font program (FontFile2), decompressed. */
async function fontFiles(bytes: Uint8Array): Promise<Uint8Array[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.context.enumerateIndirectObjects()
    .map(([, obj]) => obj)
    .filter((o): o is PDFDict => o instanceof PDFDict && o.get(PDFName.of('Type')) === PDFName.of('FontDescriptor'))
    .map((d) => doc.context.lookup(d.get(PDFName.of('FontFile2'))) as PDFRawStream)
    .map((stream) => decodePDFRawStream(stream).decode());
}

/** True when a descriptor name is the given PostScript name, allowing a subset tag or suffix. */
const isFace = (postscriptName: string) => (name: string) =>
  new RegExp(`^/(?:[A-Z]{6}\\+)?${postscriptName}(?:-\\d+)?$`).test(name);

const jane = rich('Jane Doe', '123 Main St', 'Springfield, IL 62701');
const john = rich('John Roe', '456 Oak Ave', 'Shelbyville, IL 62565');

async function pageSize(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPage(0).getSize();
}

describe('buildEnvelopePdf', () => {
  it('produces one #10 landscape page for one block', async () => {
    const { bytes, warnings } = await buildEnvelopePdf([jane], settings, fixtureProvider);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeCloseTo(9.5 * 72, 3);
    expect(height).toBeCloseTo(4.125 * 72, 3);
    expect(warnings).toEqual([]);
  });

  it('produces one page per block', async () => {
    const { bytes } = await buildEnvelopePdf([jane, john], settings, fixtureProvider);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
  });

  it('uses the chosen size', async () => {
    const { bytes } = await buildEnvelopePdf([jane], { ...settings, size: 'a7' }, fixtureProvider);
    const { width, height } = await pageSize(bytes);
    expect(width).toBeCloseTo(7.25 * 72, 3);
    expect(height).toBeCloseTo(5.25 * 72, 3);
  });

  it('uses the custom size when size is custom', async () => {
    const { bytes } = await buildEnvelopePdf(
      [jane], { ...settings, size: 'custom', customWidthIn: 7, customHeightIn: 5 }, fixtureProvider,
    );
    const { width, height } = await pageSize(bytes);
    expect(width).toBeCloseTo(504, 3);
    expect(height).toBeCloseTo(360, 3);
  });

  it('reports characters it had to replace, with the block index', async () => {
    const { warnings } = await buildEnvelopePdf([rich('Zoë ❤', '1 Rd')], settings, fixtureProvider);
    expect(warnings).toEqual([{ block: 0, replaced: ['❤'] }]);
  });

  it('reports return-address replacements once, not per block', async () => {
    const { warnings, returnReplaced } = await buildEnvelopePdf([jane, john], {
      ...settings,
      returnAddress: rich('Zoë ❤ Church'),
    }, fixtureProvider);
    expect(warnings).toEqual([]);
    expect(returnReplaced).toEqual(['❤']);
  });

  it('returns no return-address replacements when showReturn is false', async () => {
    const { returnReplaced } = await buildEnvelopePdf([jane], {
      ...settings,
      showReturn: false,
      returnAddress: rich('Zoë ❤ Church'),
    }, fixtureProvider);
    expect(returnReplaced).toEqual([]);
  });

  it('draws no recipient block when showRecipient is false', async () => {
    const { bytes, warnings } = await buildEnvelopePdf(
      [rich('Zoë ❤', '1 Rd')], { ...settings, showRecipient: false }, fixtureProvider,
    );
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(warnings).toEqual([]);
  });

  it('still makes one page per block when showRecipient is false', async () => {
    const { bytes } = await buildEnvelopePdf([jane, john], { ...settings, showRecipient: false }, fixtureProvider);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
  });

  it('builds a blank page when both blocks are off', async () => {
    const { bytes, warnings, returnReplaced } = await buildEnvelopePdf(
      [jane], { ...settings, showRecipient: false, showReturn: false }, fixtureProvider,
    );
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(warnings).toEqual([]);
    expect(returnReplaced).toEqual([]);
  });

  it('throws when given no blocks', async () => {
    await expect(buildEnvelopePdf([], settings, fixtureProvider)).rejects.toThrow(/at least one/i);
  });

  it('tolerates empty blocks and empty lines', async () => {
    const { bytes } = await buildEnvelopePdf([{ lines: [] }, rich('', 'Jane Doe', '')], settings, fixtureProvider);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
  });

  it('Times still produces a valid document', async () => {
    const times = { ...defaultRecipientLayout(), font: { kind: 'standard', id: 'times' } as FontRef };
    const { bytes } = await buildEnvelopePdf(
      [jane], { ...settings, showReturn: false, recipientLayout: times }, fixtureProvider,
    );
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it('embeds a bundled font, producing a larger loadable PDF', async () => {
    const standard = await buildEnvelopePdf([jane], settings, fixtureProvider);
    const embedded = await buildEnvelopePdf([jane], {
      ...settings,
      recipientLayout: { ...defaultRecipientLayout(), font: LATO },
    }, fixtureProvider);
    const doc = await PDFDocument.load(embedded.bytes);
    expect(doc.getPageCount()).toBe(1);
    const descriptors = doc.context.enumerateIndirectObjects()
      .map(([, obj]) => obj)
      .filter((o): o is PDFDict => o instanceof PDFDict && o.get(PDFName.of('Type')) === PDFName.of('FontDescriptor'));
    const lato = descriptors.find((d) => String(d.get(PDFName.of('FontName'))).includes('Lato'));
    expect(lato).toBeDefined();
    expect(lato!.has(PDFName.of('FontFile2'))).toBe(true);
    // Subsetting keeps only the used glyphs, so growth is a few KB rather than the full ~70 KB file.
    expect(embedded.bytes.length - standard.bytes.length).toBeGreaterThan(2 * 1024);
  });

  it('replaces and reports characters a bundled font lacks', async () => {
    const { warnings, returnReplaced } = await buildEnvelopePdf([rich('Zoë 😀', '1 Rd')], {
      ...settings,
      returnAddress: rich('Church 😀'),
      returnLayout: { ...defaultReturnLayout(), font: LATO },
      recipientLayout: { ...defaultRecipientLayout(), font: LATO },
    }, fixtureProvider);
    expect(warnings).toEqual([{ block: 0, replaced: ['😀'] }]);
    expect(returnReplaced).toEqual(['😀']);
  });

  it('loads each distinct font once per document', async () => {
    const calls: FontRef[] = [];
    const counting: FontProvider = {
      availableFaces: fixtureProvider.availableFaces,
      getBytes: async (ref, style) => { calls.push(ref); return fixtureProvider.getBytes(ref, style); },
    };
    await buildEnvelopePdf([jane, john], {
      ...settings,
      returnLayout: { ...defaultReturnLayout(), font: LATO },
      recipientLayout: { ...defaultRecipientLayout(), font: { kind: 'bundled', id: 'lato' } },
    }, counting);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ kind: 'bundled', id: 'lato' });
  });

  it('names the font when its bytes cannot be loaded', async () => {
    const failing: FontProvider = {
      availableFaces: async () => NO_FACES,
      getBytes: async () => { throw new Error('Couldn\'t download the font Lora.'); },
    };
    await expect(buildEnvelopePdf([jane], {
      ...settings,
      recipientLayout: { ...defaultRecipientLayout(), font: { kind: 'bundled', id: 'lora', family: 'Lora' } },
    }, failing)).rejects.toThrow(/Lora/);
  });

  it('names the font when its bytes are not a usable font file', async () => {
    const junk: FontProvider = { availableFaces: async () => NO_FACES, getBytes: async () => new Uint8Array([1, 2, 3, 4]) };
    await expect(buildEnvelopePdf([jane], {
      ...settings,
      recipientLayout: { ...defaultRecipientLayout(), font: { kind: 'google', family: 'Inter' } },
    }, junk)).rejects.toThrow(/Inter/);
  });

  it('places blocks with right/bottom anchors without throwing', async () => {
    const corner = { ...defaultRecipientLayout(), anchorH: 'right', anchorV: 'bottom', align: 'right' } as const;
    const { bytes } = await buildEnvelopePdf([jane], { ...settings, recipientLayout: corner }, fixtureProvider);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });
  it('draws a bold run in Helvetica with Helvetica-Bold', async () => {
    const block: RichText = { lines: [{ runs: [{ text: 'Jane ' }, { text: 'Doe', bold: true }] }] };
    const { bytes } = await buildEnvelopePdf([block], { ...settings, showReturn: false }, fixtureProvider);
    const names = await baseFonts(bytes);
    expect(names).toContain('/Helvetica-Bold');
    expect(names).toContain('/Helvetica');
  });

  it('maps every face of both standard fonts', async () => {
    const block: RichText = {
      lines: [{
        runs: [{ text: 'a ' }, { text: 'b ', bold: true }, { text: 'c ', italic: true }, { text: 'd', bold: true, italic: true }],
      }],
    };
    const helvetica = await buildEnvelopePdf([block], { ...settings, showReturn: false }, fixtureProvider);
    expect((await baseFonts(helvetica.bytes)).sort()).toEqual(
      ['/Helvetica', '/Helvetica-Bold', '/Helvetica-BoldOblique', '/Helvetica-Oblique'],
    );
    const times = await buildEnvelopePdf([block], {
      ...settings,
      showReturn: false,
      recipientLayout: { ...defaultRecipientLayout(), font: { kind: 'standard', id: 'times' } },
    }, fixtureProvider);
    expect((await baseFonts(times.bytes)).sort()).toEqual(['/Times-Bold', '/Times-BoldItalic', '/Times-Italic', '/Times-Roman']);
  });

  it('embeds only the faces that are used', async () => {
    const { bytes } = await buildEnvelopePdf([jane, john], settings, fixtureProvider);
    expect(await baseFonts(bytes)).toEqual(['/Helvetica']);
  });

  it('embeds a bundled bold face for a bold run', async () => {
    const block: RichText = { lines: [{ runs: [{ text: 'Jane ' }, { text: 'Doe', bold: true }] }] };
    const { bytes } = await buildEnvelopePdf([block], {
      ...settings, showReturn: false, recipientLayout: { ...defaultRecipientLayout(), font: LATO },
    }, fixtureProvider);
    const names = await descriptorNames(bytes);
    expect(names.some(isFace('Lato-Bold'))).toBe(true);
    expect(names.some(isFace('Lato-Regular'))).toBe(true);
  });

  it('falls back to the regular face of a script font for a bold run', async () => {
    const block: RichText = { lines: [{ runs: [{ text: 'Jane ' }, { text: 'Doe', bold: true, italic: true }] }] };
    const { bytes } = await buildEnvelopePdf([block], {
      ...settings, showReturn: false, recipientLayout: { ...defaultRecipientLayout(), font: GREAT_VIBES },
    }, fixtureProvider);
    const names = (await descriptorNames(bytes)).filter((n) => n.includes('GreatVibes'));
    expect(names).toHaveLength(1);
    expect(names.every(isFace('GreatVibes-Regular'))).toBe(true);
  });

  it('embeds one font when the provider falls back to the same bytes', async () => {
    // A provider that claims a bold face but serves the regular bytes for it.
    const sameBytes: FontProvider = {
      availableFaces: async () => ({ bold: true, italic: false, boldItalic: false }),
      getBytes: async () => greatVibesBytes,
    };
    const block: RichText = { lines: [{ runs: [{ text: 'Jane ' }, { text: 'Doe', bold: true }] }] };
    const { bytes } = await buildEnvelopePdf([block], {
      ...settings, showReturn: false, recipientLayout: { ...defaultRecipientLayout(), font: GREAT_VIBES },
    }, sameBytes);
    expect((await descriptorNames(bytes)).filter((n) => n.includes('GreatVibes'))).toHaveLength(1);
  });

  it('treats a provider that cannot list faces as regular only', async () => {
    const noListing: FontProvider = {
      availableFaces: async () => { throw new Error('offline'); },
      getBytes: fixtureProvider.getBytes,
    };
    const block: RichText = { lines: [{ runs: [{ text: 'Doe', bold: true }] }] };
    const { bytes } = await buildEnvelopePdf([block], {
      ...settings, showReturn: false, recipientLayout: { ...defaultRecipientLayout(), font: LATO },
    }, noListing);
    const names = await descriptorNames(bytes);
    expect(names.some(isFace('Lato-Regular'))).toBe(true);
    expect(names.some(isFace('Lato-Bold'))).toBe(false);
  });

  it('loads each font face once per document', async () => {
    const calls: string[] = [];
    const counting: FontProvider = {
      availableFaces: fixtureProvider.availableFaces,
      getBytes: async (ref, style) => {
        calls.push(`${ref.kind}:${style.bold ? 'bold' : 'regular'}`);
        return fixtureProvider.getBytes(ref, style);
      },
    };
    const block: RichText = {
      lines: [{ runs: [{ text: 'Jane ' }, { text: 'Doe', bold: true }] }, { runs: [{ text: '1 Rd' }] }],
    };
    await buildEnvelopePdf([block, block], {
      ...settings,
      returnLayout: { ...defaultReturnLayout(), font: LATO },
      recipientLayout: { ...defaultRecipientLayout(), font: LATO },
    }, counting);
    expect(calls.sort()).toEqual(['bundled:bold', 'bundled:regular']);
  });

  it('sanitizes each run with its own face', async () => {
    // Lato serves the regular face and Great Vibes the bold one; their glyph coverage differs.
    const ONLY_LATO = '♩'; // U+2669 QUARTER NOTE: in Lato, not in Great Vibes
    const probe = await PDFDocument.create();
    probe.registerFontkit(fontkit);
    const lato = await probe.embedFont(latoBytes);
    const greatVibes = await probe.embedFont(greatVibesBytes);
    expect(lato.getCharacterSet()).toContain(ONLY_LATO.codePointAt(0));
    expect(greatVibes.getCharacterSet()).not.toContain(ONLY_LATO.codePointAt(0));

    const mixed: FontProvider = {
      availableFaces: async () => ({ bold: true, italic: false, boldItalic: false }),
      getBytes: async (_ref, style) => (style.bold ? greatVibesBytes : latoBytes),
    };
    const regularHas: RichText = { lines: [{ runs: [{ text: `Ro${ONLY_LATO}e ` }, { text: 'Doe', bold: true }] }] };
    const boldLacks: RichText = { lines: [{ runs: [{ text: 'Rose ' }, { text: `Do${ONLY_LATO}e`, bold: true }] }] };
    const { warnings } = await buildEnvelopePdf([regularHas, boldLacks], {
      ...settings, showReturn: false, recipientLayout: { ...defaultRecipientLayout(), font: LATO },
    }, mixed);
    expect(warnings).toEqual([{ block: 1, replaced: [ONLY_LATO] }]);
  });

  it('draws a rich return address with a line size override', async () => {
    const returnAddress: RichText = {
      lines: [{ runs: [{ text: 'First Church', bold: true }], size: 24 }, { runs: [{ text: '1 Chapel Rd', italic: true }] }],
    };
    const { bytes, returnReplaced } = await buildEnvelopePdf([jane], { ...settings, returnAddress }, fixtureProvider);
    expect(returnReplaced).toEqual([]);
    expect((await baseFonts(bytes)).sort()).toEqual(['/Helvetica', '/Helvetica-Bold', '/Helvetica-Oblique']);
  });

  it('ignores a return address that is only whitespace', async () => {
    const { bytes } = await buildEnvelopePdf([jane], {
      ...settings, returnAddress: rich('   ', ''), recipientLayout: { ...defaultRecipientLayout(), font: LATO },
    }, fixtureProvider);
    expect(await baseFonts(bytes)).not.toContain('/Helvetica');
  });

  it('subsets a font with unpadded glyphs from a padded copy, keeping every outline intact', async () => {
    const lobster: FontProvider = { availableFaces: async () => NO_FACES, getBytes: async () => lobsterBytes };
    const { bytes, subsetFallbacks } = await buildEnvelopePdf([jane, john], {
      ...settings, returnLayout: { ...defaultReturnLayout(), font: LOBSTER },
    }, lobster);
    const programs = await fontFiles(bytes);
    expect(programs).toHaveLength(1);
    expect(programs[0].length).toBeLessThan(100 * 1024);
    // The subset has no cmap, so check by glyph ID: every glyph after .notdef decodes with an outline,
    // except the space.
    const subset = fontkit.create(programs[0]);
    const outlines = Array.from({ length: subset.numGlyphs - 1 }, (_, i) => subset.getGlyph(i + 1).path.toSVG());
    expect(outlines.filter((svg) => svg === '')).toHaveLength(1);
    expect(subsetFallbacks).toEqual([]);
  });

  it('still subsets a font whose subset is sound', async () => {
    const { bytes, subsetFallbacks } = await buildEnvelopePdf([jane, john], {
      ...settings, recipientLayout: { ...defaultRecipientLayout(), font: LATO },
    }, fixtureProvider);
    const programs = await fontFiles(bytes);
    expect(programs).toHaveLength(1);
    expect(programs[0].length).toBeLessThan(100 * 1024);
    expect(subsetFallbacks).toEqual([]);
  });

  it('reports no subset fallbacks for standard fonts', async () => {
    const { subsetFallbacks } = await buildEnvelopePdf([jane], settings, fixtureProvider);
    expect(subsetFallbacks).toEqual([]);
  });
});

/** The first page's content stream operators, decoded to text. */
async function pageContent(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const contents = doc.getPage(0).node.Contents();
  const refs = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
  return refs
    .map((ref) => doc.context.lookup(ref) as PDFRawStream)
    .map((stream) => new TextDecoder().decode(decodePDFRawStream(stream).decode()))
    .join('\n');
}

/** Each text matrix `a b c d e f Tm` in drawing order, as numbers. */
async function textMatrices(bytes: Uint8Array): Promise<number[][]> {
  const content = await pageContent(bytes);
  return [...content.matchAll(/((?:-?[\d.]+\s+){6})Tm/g)].map((m) => m[1].trim().split(/\s+/).map(Number));
}

describe('rotatePoint', () => {
  const W = 10;
  const H = 4;

  it('maps a known point for each rotation', () => {
    expect(rotatePoint(1, 1, W, H, 0)).toEqual({ x: 1, y: 1 });
    expect(rotatePoint(1, 1, W, H, 90)).toEqual({ x: 3, y: 1 });
    expect(rotatePoint(1, 1, W, H, 180)).toEqual({ x: 9, y: 3 });
    expect(rotatePoint(1, 1, W, H, 270)).toEqual({ x: 1, y: 9 });
  });

  it('turns the canvas counterclockwise, like pdf-lib rotate', () => {
    // The direction of the canvas's x axis after the turn: (cos r, sin r).
    const axis = (r: Rotation) => {
      const a = rotatePoint(0, 0, W, H, r);
      const b = rotatePoint(1, 0, W, H, r);
      return { x: b.x - a.x, y: b.y - a.y };
    };
    expect(axis(0)).toEqual({ x: 1, y: 0 });
    expect(axis(90)).toEqual({ x: 0, y: 1 });
    expect(axis(180)).toEqual({ x: -1, y: 0 });
    expect(axis(270)).toEqual({ x: 0, y: -1 });
  });

  it('keeps the canvas corners inside the turned frame, from the origin', () => {
    const corners: [number, number][] = [[0, 0], [W, 0], [0, H], [W, H]];
    for (const r of [0, 90, 180, 270] as Rotation[]) {
      const [tw, th] = r === 90 || r === 270 ? [H, W] : [W, H];
      const pts = corners.map(([x, y]) => rotatePoint(x, y, W, H, r));
      expect(Math.min(...pts.map((p) => p.x)), `r=${r}`).toBe(0);
      expect(Math.min(...pts.map((p) => p.y)), `r=${r}`).toBe(0);
      expect(Math.max(...pts.map((p) => p.x)), `r=${r}`).toBe(tw);
      expect(Math.max(...pts.map((p) => p.y)), `r=${r}`).toBe(th);
    }
  });
});

describe('pageSizeFor', () => {
  const num10 = { ...settings, size: 'num10' as const };
  const num6_75 = { ...settings, size: 'num6_75' as const };

  it('is the envelope itself for envelope paper', () => {
    const l = pageSizeFor(num10);
    expect([l.widthPt, l.heightPt]).toEqual([684, 297]);
    expect(l.envelope).toEqual({ x: 0, y: 0, width: 684, height: 297 });
    expect(l.exceedsPaper).toBe(false);
  });

  it('swaps the sides of a turned envelope', () => {
    const l = pageSizeFor({ ...num10, rotation: 90 });
    expect([l.widthPt, l.heightPt]).toEqual([297, 684]);
    expect([l.envelopeW, l.envelopeH]).toEqual([684, 297]);
    expect([pageSizeFor({ ...num10, rotation: 180 }).widthPt, pageSizeFor({ ...num10, rotation: 270 }).widthPt]).toEqual([684, 297]);
  });

  it('places a #6¾ at the top left, center, or right of Letter', () => {
    const at = (position: 'left' | 'center' | 'right') => pageSizeFor({ ...num6_75, paper: { kind: 'letter', position } });
    expect(at('left').envelope).toEqual({ x: 0, y: 531, width: 468, height: 261 });
    expect(at('center').envelope).toEqual({ x: 72, y: 531, width: 468, height: 261 });
    expect(at('right').envelope).toEqual({ x: 144, y: 531, width: 468, height: 261 });
    expect([at('center').widthPt, at('center').heightPt]).toEqual([612, 792]);
    expect(at('center').exceedsPaper).toBe(false);
  });

  it('clamps a #10 wider than Letter to the left edge and flags it', () => {
    for (const position of ['left', 'center', 'right'] as const) {
      const l = pageSizeFor({ ...num10, paper: { kind: 'letter', position } });
      expect(l.envelope.x, position).toBe(0);
      expect(l.envelope.y, position).toBe(792 - 297);
      expect(l.exceedsPaper, position).toBe(true);
    }
  });

  it('fits a #10 on Letter once it is turned', () => {
    const l = pageSizeFor({ ...num10, paper: { kind: 'letter', position: 'center' }, rotation: 90 });
    expect(l.envelope).toEqual({ x: (612 - 297) / 2, y: 792 - 684, width: 297, height: 684 });
    expect(l.exceedsPaper).toBe(false);
  });

  it('uses portrait A4', () => {
    const l = pageSizeFor({ ...num6_75, paper: { kind: 'a4', position: 'right' } });
    expect([l.widthPt, l.heightPt]).toEqual([595.28, 841.89]);
    expect(l.envelope.x).toBeCloseTo(595.28 - 468, 6);
    expect(l.envelope.y).toBeCloseTo(841.89 - 261, 6);
  });
});

describe('buildEnvelopePdf on printer paper', () => {
  const num6_75: EnvelopeSettings = { ...settings, size: 'num6_75' };

  it('makes a Letter page', async () => {
    const { bytes, envelopeExceedsPaper } = await buildEnvelopePdf(
      [jane], { ...num6_75, paper: { kind: 'letter', position: 'center' } }, fixtureProvider,
    );
    const { width, height } = await pageSize(bytes);
    expect([width, height]).toEqual([612, 792]);
    expect(envelopeExceedsPaper).toBeUndefined();
  });

  it('makes an A4 page', async () => {
    const { bytes } = await buildEnvelopePdf([jane], { ...num6_75, paper: { kind: 'a4', position: 'left' } }, fixtureProvider);
    const { width, height } = await pageSize(bytes);
    expect(width).toBeCloseTo(595.28, 2);
    expect(height).toBeCloseTo(841.89, 2);
  });

  it('moves every line by the envelope position on the sheet', async () => {
    const base = await textMatrices((await buildEnvelopePdf([jane], num6_75, fixtureProvider)).bytes);
    for (const [position, dx] of [['left', 0], ['center', 72], ['right', 144]] as const) {
      const placed = await textMatrices((await buildEnvelopePdf(
        [jane], { ...num6_75, paper: { kind: 'letter', position } }, fixtureProvider,
      )).bytes);
      expect(placed.length).toBe(base.length);
      placed.forEach((m, i) => {
        expect(m[4], `${position} x`).toBeCloseTo(base[i][4] + dx, 3);
        expect(m[5], `${position} y`).toBeCloseTo(base[i][5] + 531, 3);
      });
    }
  });

  it('flags a #10 that is wider than Letter', async () => {
    const result = await buildEnvelopePdf([jane], { ...settings, paper: { kind: 'letter', position: 'center' } }, fixtureProvider);
    expect(result.envelopeExceedsPaper).toBe(true);
  });

  it('stands a #10 on end at 90 degrees', async () => {
    const { bytes } = await buildEnvelopePdf([jane], { ...settings, rotation: 90 }, fixtureProvider);
    const { width, height } = await pageSize(bytes);
    expect(width).toBeCloseTo(297, 3);
    expect(height).toBeCloseTo(684, 3);
  });

  it('draws turned text at the turned origin of each line', async () => {
    const base = await textMatrices((await buildEnvelopePdf([jane], settings, fixtureProvider)).bytes);
    const turned = await textMatrices((await buildEnvelopePdf([jane], { ...settings, rotation: 90 }, fixtureProvider)).bytes);
    expect(turned.length).toBe(base.length);
    turned.forEach((m, i) => {
      const [a, b, c, d] = m;
      expect([a, b, c, d].map((v) => Math.round(v))).toEqual([0, 1, -1, 0]);
      const p = rotatePoint(base[i][4], base[i][5], 684, 297, 90);
      expect(m[4]).toBeCloseTo(p.x, 3);
      expect(m[5]).toBeCloseTo(p.y, 3);
    });
  });

  it('draws the dashed gray outline only when asked', async () => {
    const letter: EnvelopeSettings = { ...num6_75, paper: { kind: 'letter', position: 'center' } };
    const plain = await pageContent((await buildEnvelopePdf([jane], letter, fixtureProvider)).bytes);
    const outlined = await pageContent((await buildEnvelopePdf([jane], letter, fixtureProvider, { outline: true })).bytes);
    const dash = /\]\s+[\d.]+\s+d\b/;
    const gray = /0\.78\d*\s+0\.78\d*\s+0\.78\d*\s+RG/;
    expect(plain).not.toMatch(dash);
    expect(plain).not.toMatch(gray);
    expect(outlined).toMatch(dash);
    expect(outlined).toMatch(gray);
    // pdf-lib moves to the corner, then strokes the rectangle's path.
    expect(outlined).toMatch(/1 0 0 1 72 531 cm/);
    expect(outlined).toMatch(/468 261 l/);
    const envelopePage = await pageContent((await buildEnvelopePdf([jane], num6_75, fixtureProvider, { outline: true })).bytes);
    expect(envelopePage).not.toMatch(dash);
  });
});
