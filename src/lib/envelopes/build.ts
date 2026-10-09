import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { resolveEnvelopeSize, type EnvelopeSizeId } from './sizes';
import { layoutRichBlock, type BlockLayout, type PlacedRichLine } from './layout';
import { sanitizeForFont } from '../pdf/text';
import { subsetSource } from '../pdf/subset-check';
import {
  FACE_LABELS, NO_FACES, faceKey, fontLabel, fontRefKey, isRegularFace, resolveFace,
  type AvailableFaces, type FaceKey, type FaceStyle, type FontProvider, type FontRef, type StandardFontId,
} from '../fonts/types';
import { normalizeRich, runStyle, type RichLine, type RichText } from '../richtext';
import { errorMessage } from '../errors';

export type EnvelopeSettings = {
  size: EnvelopeSizeId | 'custom';
  /** Used when size is 'custom'. Inches, 3–20. */
  customWidthIn: number;
  /** Used when size is 'custom'. Inches, 3–20. */
  customHeightIn: number;
  showReturn: boolean;
  /** When false, no recipient block is drawn; each block still gets its own page. */
  showRecipient: boolean;
  returnAddress: RichText;
  returnLayout: BlockLayout;
  recipientLayout: BlockLayout;
};

export type EnvelopeWarning = { block: number; replaced: string[] };

export type EnvelopePdf = {
  bytes: Uint8Array;
  /** Replacements in recipient blocks only (empty when showRecipient is false). */
  warnings: EnvelopeWarning[];
  /** Characters replaced in the return address (empty when none or when showReturn is false). */
  returnReplaced: string[];
  /**
   * Faces embedded whole, such as `Lobster` or `Lora Bold`, because fontkit's subsetter would
   * corrupt their glyphs even from a padded copy (see subsetSource). For diagnostics.
   */
  subsetFallbacks: string[];
};

const PT_PER_IN = 72;
const BLACK = rgb(0, 0, 0);

type Fontkit = Parameters<PDFDocument['registerFontkit']>[0];
let fontkitOnce: Promise<Fontkit> | null = null;

/** fontkit is only needed to embed non-standard fonts, so it loads on first use in its own chunk. */
function loadFontkit(): Promise<Fontkit> {
  if (!fontkitOnce) {
    const p = import('@pdf-lib/fontkit').then((m) => m.default);
    fontkitOnce = p;
    p.catch(() => {
      if (fontkitOnce === p) fontkitOnce = null;
    });
  }
  return fontkitOnce;
}

const STANDARD_FACES: Record<StandardFontId, Record<FaceKey, StandardFonts>> = {
  helvetica: {
    regular: StandardFonts.Helvetica,
    bold: StandardFonts.HelveticaBold,
    italic: StandardFonts.HelveticaOblique,
    bolditalic: StandardFonts.HelveticaBoldOblique,
  },
  times: {
    regular: StandardFonts.TimesRoman,
    bold: StandardFonts.TimesRomanBold,
    italic: StandardFonts.TimesRomanItalic,
    bolditalic: StandardFonts.TimesRomanBoldItalic,
  },
};

/**
 * Resolves each (font, face) once per document. Standard fonts map to their built-in faces; other
 * fonts use the nearest face the provider has (bold italic → bold → regular; italic → regular),
 * and identical bytes are embedded only once. Other fonts are subset, from a padded copy when that
 * is what keeps the subset's glyphs intact (see subsetSource), or embedded whole and named in
 * `fallbacks` when neither copy subsets cleanly.
 * `textFor` gives the text the document draws in a font, keyed by fontRefKey(ref).
 */
function fontResolver(doc: PDFDocument, fonts: FontProvider, textFor: Map<string, string>, fallbacks: string[]) {
  const faces = new Map<string, Promise<AvailableFaces>>();
  const resolved = new Map<string, Promise<PDFFont>>();
  const byBytes = new Map<Uint8Array, Promise<PDFFont>>();

  function available(ref: FontRef): Promise<AvailableFaces> {
    const key = fontRefKey(ref);
    let p = faces.get(key);
    if (!p) {
      p = fonts.availableFaces(ref).catch(() => NO_FACES);
      faces.set(key, p);
    }
    return p;
  }

  async function load(ref: FontRef, face: FaceStyle): Promise<PDFFont> {
    if (ref.kind === 'standard') return doc.embedFont(STANDARD_FACES[ref.id][faceKey(face)]);
    const [bytes, fontkit] = await Promise.all([fonts.getBytes(ref, face), loadFontkit()]);
    const name = isRegularFace(face) ? fontLabel(ref) : `${fontLabel(ref)} ${FACE_LABELS[faceKey(face)]}`;
    if (!bytes) throw new Error(`No font data for ${name}.`);
    let p = byBytes.get(bytes);
    if (!p) {
      doc.registerFontkit(fontkit);
      p = subsetSource(bytes, textFor.get(fontRefKey(ref)) ?? '')
        .then((source) => {
          if (!source) fallbacks.push(name);
          return doc.embedFont(source ?? bytes, { subset: source !== null });
        })
        .catch((err: unknown) => {
          throw new Error(`The font ${name} could not be used: ${errorMessage(err)}`);
        });
      byBytes.set(bytes, p);
    }
    return p;
  }

  return async (ref: FontRef, style: FaceStyle): Promise<PDFFont> => {
    const face = ref.kind === 'standard' || isRegularFace(style) ? style : resolveFace(style, await available(ref));
    const key = fontRefKey(ref, face);
    let p = resolved.get(key);
    if (!p) {
      p = load(ref, face);
      resolved.set(key, p);
    }
    return p;
  };
}

type FontFor = (ref: FontRef, style: FaceStyle) => Promise<PDFFont>;

/** All text each font draws, keyed by fontRefKey, so a subset check sees every glyph in use. */
function textByFont(blocks: RichText[], settings: EnvelopeSettings): Map<string, string> {
  const text = new Map<string, string>();
  const add = (ref: FontRef, rich: RichText) => {
    const key = fontRefKey(ref);
    const runs = normalizeRich(rich).lines.flatMap((line) => line.runs.map((run) => run.text));
    text.set(key, (text.get(key) ?? '') + runs.join(''));
  };
  if (settings.showReturn) add(settings.returnLayout.font, settings.returnAddress);
  if (settings.showRecipient) blocks.forEach((block) => add(settings.recipientLayout.font, block));
  return text;
}

/** A block ready to lay out: sanitized lines and the font for each face its runs use. */
type PreparedBlock = { lines: RichLine[]; fonts: Map<FaceKey, PDFFont>; replaced: Set<string> };

/** Normalize a block, load the face of each run, and sanitize each run for its own face. */
async function prepareBlock(rich: RichText, ref: FontRef, fontFor: FontFor): Promise<PreparedBlock> {
  const fonts = new Map<FaceKey, PDFFont>();
  const replaced = new Set<string>();
  const lines: RichLine[] = [];
  for (const line of normalizeRich(rich).lines) {
    const runs = [];
    for (const run of line.runs) {
      const style = runStyle(run);
      let font = fonts.get(faceKey(style));
      if (!font) {
        font = await fontFor(ref, style);
        fonts.set(faceKey(style), font);
      }
      const r = sanitizeForFont(run.text, font);
      r.replaced.forEach((c) => replaced.add(c));
      runs.push({ ...run, text: r.text });
    }
    lines.push(line.size === undefined ? { runs } : { runs, size: line.size });
  }
  return { lines, fonts, replaced };
}

/** Lay out a prepared block, measuring each run in its own face. */
function placeBlock(block: PreparedBlock, layout: BlockLayout, pageW: number, pageH: number): PlacedRichLine[] {
  return layoutRichBlock({
    pageW,
    pageH,
    lines: block.lines,
    measure: (text, size, style) => block.fonts.get(faceKey(style))!.widthOfTextAtSize(text, size),
    layout,
  }).lines;
}

function drawBlock(page: PDFPage, block: PreparedBlock, placed: PlacedRichLine[]): void {
  for (const line of placed) {
    for (const run of line.runs) {
      if (run.text.trim() === '') continue;
      const font = block.fonts.get(faceKey(run.style))!;
      page.drawText(run.text, { x: run.x, y: line.y, size: line.size, font, color: BLACK });
    }
  }
}

/**
 * Build a PDF with one envelope page per address block.
 * Blocks and the return address are rich text; each is normalized (see normalizeRich) before layout.
 * Each run is drawn in its own face of the block's font, at its line's size.
 * When settings.showRecipient is false the block text is ignored, but each block still yields a page.
 * Fonts other than the standard ones come from `fonts` and are embedded as subsets, one per face used,
 * except faces the subsetter would corrupt even after padding, which are embedded whole (listed in
 * subsetFallbacks).
 */
export async function buildEnvelopePdf(
  blocks: RichText[],
  settings: EnvelopeSettings,
  fonts: FontProvider,
): Promise<EnvelopePdf> {
  if (blocks.length === 0) throw new Error('Need at least one address block');

  const { widthIn, heightIn } = resolveEnvelopeSize(settings);
  const pageW = widthIn * PT_PER_IN;
  const pageH = heightIn * PT_PER_IN;

  const doc = await PDFDocument.create();
  const subsetFallbacks: string[] = [];
  const fontFor = fontResolver(doc, fonts, textByFont(blocks, settings), subsetFallbacks);

  const returnBlock = settings.showReturn
    ? await prepareBlock(settings.returnAddress, settings.returnLayout.font, fontFor)
    : null;
  const returnPlaced = returnBlock ? placeBlock(returnBlock, settings.returnLayout, pageW, pageH) : [];

  const warnings: EnvelopeWarning[] = [];

  for (const [index, block] of blocks.entries()) {
    const page = doc.addPage([pageW, pageH]);
    if (returnBlock) drawBlock(page, returnBlock, returnPlaced);

    if (!settings.showRecipient) continue;
    const recipient = await prepareBlock(block, settings.recipientLayout.font, fontFor);
    drawBlock(page, recipient, placeBlock(recipient, settings.recipientLayout, pageW, pageH));
    if (recipient.replaced.size > 0) warnings.push({ block: index, replaced: [...recipient.replaced] });
  }

  return {
    bytes: await doc.save(),
    warnings,
    returnReplaced: returnBlock ? [...returnBlock.replaced] : [],
    subsetFallbacks,
  };
}
