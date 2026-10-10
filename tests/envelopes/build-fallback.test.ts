/// <reference types="node" />
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PDFDocument, PDFDict, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { buildEnvelopePdf, type EnvelopeSettings } from '../../src/lib/envelopes/build';
import { defaultRecipientLayout, defaultReturnLayout } from '../../src/lib/envelopes/layout';
import type { FontProvider } from '../../src/lib/fonts/types';
import { plainToRich } from '../../src/lib/richtext';

// Stand in for a font that no copy can subset cleanly.
vi.mock('../../src/lib/pdf/subset-check', () => ({ subsetSource: vi.fn(async () => null) }));

const latoBytes = new Uint8Array(readFileSync(resolve(__dirname, '../../public/fonts/lato/Lato-Regular.ttf')));
const lato: FontProvider = {
  availableFaces: async () => ({ bold: false, italic: false, boldItalic: false }),
  getBytes: async () => latoBytes,
};

const settings: EnvelopeSettings = {
  size: 'num10',
  customWidthIn: 7,
  customHeightIn: 5,
  showReturn: true,
  showRecipient: true,
  returnAddress: plainToRich('First Church\n1 Chapel Rd'),
  returnLayout: { ...defaultReturnLayout(), font: { kind: 'bundled', id: 'lato', family: 'Lato' } },
  recipientLayout: defaultRecipientLayout(),
  paper: { kind: 'envelope', position: 'center' },
  rotation: 0,
};

describe('buildEnvelopePdf when a font cannot be subset', () => {
  it('embeds the whole font and names it in subsetFallbacks', async () => {
    const { bytes, subsetFallbacks } = await buildEnvelopePdf([plainToRich('Jane Doe')], settings, lato);
    const doc = await PDFDocument.load(bytes);
    const programs = doc.context.enumerateIndirectObjects()
      .map(([, obj]) => obj)
      .filter((o): o is PDFDict => o instanceof PDFDict && o.get(PDFName.of('Type')) === PDFName.of('FontDescriptor'))
      .map((d) => decodePDFRawStream(doc.context.lookup(d.get(PDFName.of('FontFile2'))) as PDFRawStream).decode());
    expect(programs.map((p) => p.length)).toEqual([latoBytes.length]);
    expect(subsetFallbacks).toEqual(['Lato']);
  });
});
