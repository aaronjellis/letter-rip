import { describe, it, expect } from 'vitest';
import {
  ENVELOPE_SIZES,
  SIZE_GROUPS,
  CUSTOM_MIN_IN,
  CUSTOM_MAX_IN,
  getEnvelopeSize,
  DEFAULT_ENVELOPE_SIZE,
  formatSizeLabel,
  resolveEnvelopeSize,
  clampCustomInches,
  MM_PER_IN,
  inchesToMm,
  mmToInches,
  type EnvelopeSizeId,
} from '../../src/lib/envelopes/sizes';

describe('envelope sizes', () => {
  it('has #10 as the default at 9.5 x 4.125 inches', () => {
    const s = getEnvelopeSize(DEFAULT_ENVELOPE_SIZE);
    expect(s.id).toBe('num10');
    expect(s.widthIn).toBe(9.5);
    expect(s.heightIn).toBe(4.125);
  });

  it('lists every size landscape or square (width at least height)', () => {
    for (const s of ENVELOPE_SIZES) expect(s.widthIn).toBeGreaterThanOrEqual(s.heightIn);
  });

  it('has positive dimensions', () => {
    for (const s of ENVELOPE_SIZES) {
      expect(s.widthIn).toBeGreaterThan(0);
      expect(s.heightIn).toBeGreaterThan(0);
    }
  });

  it('has unique ids', () => {
    const ids = ENVELOPE_SIZES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(36);
  });

  it('throws on unknown id', () => {
    expect(() => getEnvelopeSize('bogus' as any)).toThrow(/unknown envelope size/i);
  });

  it.each([
    ['num10', 9.5, 4.125],
    ['monarch', 7.5, 3.875],
    ['a7', 7.25, 5.25],
    ['bar4', 5.125, 3.625],
    ['dl', 8.66, 4.33],
    ['c5', 9.02, 6.38],
    ['sq5_5', 5.5, 5.5],
    ['ten_thirteen', 13, 10],
  ] as [EnvelopeSizeId, number, number][])('has %s at %s x %s inches', (id, w, h) => {
    const s = getEnvelopeSize(id);
    expect(s.widthIn).toBe(w);
    expect(s.heightIn).toBe(h);
  });

  it('includes the standard offering envelope', () => {
    const s = getEnvelopeSize('offering');
    expect(s.group).toBe('US commercial');
    expect(formatSizeLabel(s)).toBe('Offering · 3⅛ × 6¼ in');
  });

  it('assigns every entry a known group', () => {
    expect(SIZE_GROUPS).toEqual([
      'US commercial',
      'Announcement',
      'Baronial',
      'Booklet and catalog',
      'International',
      'Square',
    ]);
    for (const s of ENVELOPE_SIZES) expect(SIZE_GROUPS).toContain(s.group);
  });

  it('marks only international sizes as millimeters', () => {
    for (const s of ENVELOPE_SIZES) {
      expect(s.unit === 'mm').toBe(s.group === 'International');
    }
  });
});

describe('formatSizeLabel', () => {
  it('formats #10 with vulgar fractions, height first', () => {
    expect(formatSizeLabel(getEnvelopeSize('num10'))).toBe('#10 · 4⅛ × 9½ in');
  });

  it('formats Monarch', () => {
    expect(formatSizeLabel(getEnvelopeSize('monarch'))).toBe('#7¾ Monarch · 3⅞ × 7½ in');
  });

  it('formats international sizes in millimeters', () => {
    expect(formatSizeLabel(getEnvelopeSize('dl'))).toBe('DL · 110 × 220 mm');
  });

  it('formats squares', () => {
    expect(formatSizeLabel(getEnvelopeSize('sq5_5'))).toBe('5½ inch square · 5½ × 5½ in');
  });

  it('formats whole inches without a fraction', () => {
    expect(formatSizeLabel(getEnvelopeSize('ten_thirteen'))).toBe('10×13 catalog · 10 × 13 in');
  });

  it('falls back to trimmed decimals when not an exact eighth', () => {
    expect(
      formatSizeLabel({ id: 'num10', name: 'Odd', group: 'US commercial', widthIn: 9.1, heightIn: 4.33 }),
    ).toBe('Odd · 4.33 × 9.1 in');
  });
});

describe('resolveEnvelopeSize', () => {
  it('returns custom dimensions for a custom size', () => {
    expect(resolveEnvelopeSize({ size: 'custom', customWidthIn: 7, customHeightIn: 5 })).toEqual({
      widthIn: 7,
      heightIn: 5,
    });
  });

  it('defaults a custom size to 3 x 3 inches when no dimensions are given', () => {
    expect(resolveEnvelopeSize({ size: 'custom' })).toEqual({ widthIn: 3, heightIn: 3 });
  });

  it('clamps custom dimensions to the limits', () => {
    expect(resolveEnvelopeSize({ size: 'custom', customWidthIn: 50, customHeightIn: 1 })).toEqual({
      widthIn: 20,
      heightIn: 3,
    });
  });

  it('returns table dimensions for a named size', () => {
    expect(resolveEnvelopeSize({ size: 'a7' })).toEqual({ widthIn: 7.25, heightIn: 5.25 });
  });
});

describe('clampCustomInches', () => {
  it('exposes the limits', () => {
    expect(CUSTOM_MIN_IN).toBe(3);
    expect(CUSTOM_MAX_IN).toBe(20);
  });

  it('clamps to the limits', () => {
    expect(clampCustomInches(0.5)).toBe(3);
    expect(clampCustomInches(25)).toBe(20);
    expect(clampCustomInches(8.5)).toBe(8.5);
  });

  it('falls back to the minimum for non-numbers', () => {
    expect(clampCustomInches('x')).toBe(3);
    expect(clampCustomInches(Number.NaN)).toBe(3);
  });
});

describe('inch and millimeter conversion', () => {
  it('uses 25.4 mm per inch', () => {
    expect(MM_PER_IN).toBe(25.4);
  });

  it('round-trips 7 in through 177.8 mm', () => {
    const mm = inchesToMm(7);
    expect(mm).toBeCloseTo(177.8, 10);
    expect(mmToInches(mm)).toBeCloseTo(7, 10);
    expect(mmToInches(177.8)).toBeCloseTo(7, 10);
  });
});
