export const SIZE_GROUPS = [
  'US commercial',
  'Announcement',
  'Baronial',
  'Booklet and catalog',
  'International',
  'Square',
] as const;

export type SizeGroup = (typeof SIZE_GROUPS)[number];

export type EnvelopeSizeId =
  | 'offering'
  | 'num6_25' | 'num6_75' | 'num7' | 'monarch' | 'num8_625' | 'num9' | 'num10' | 'num11' | 'num12' | 'num14'
  | 'a1' | 'a2' | 'a6' | 'a7' | 'a8' | 'a9' | 'a10'
  | 'bar4' | 'bar5_5' | 'bar6'
  | 'six_nine' | 'nine_twelve' | 'ten_thirteen'
  | 'dl' | 'c6' | 'c6c5' | 'c5' | 'c4' | 'b6' | 'b5'
  | 'sq5' | 'sq5_5' | 'sq6' | 'sq6_5' | 'sq7';

export type EnvelopeSize = {
  id: EnvelopeSizeId;
  name: string;
  group: SizeGroup;
  widthIn: number;
  heightIn: number;
  /** Unit used for the display label. Defaults to inches. */
  unit?: 'in' | 'mm';
};

/** Landscape: width is the long edge. Order matches the spec table. */
export const ENVELOPE_SIZES: readonly EnvelopeSize[] = [
  { id: 'offering', name: 'Offering', group: 'US commercial', widthIn: 6.25, heightIn: 3.125 },
  { id: 'num6_25', name: '#6¼', group: 'US commercial', widthIn: 6, heightIn: 3.5 },
  { id: 'num6_75', name: '#6¾', group: 'US commercial', widthIn: 6.5, heightIn: 3.625 },
  { id: 'num7', name: '#7', group: 'US commercial', widthIn: 6.75, heightIn: 3.75 },
  { id: 'monarch', name: '#7¾ Monarch', group: 'US commercial', widthIn: 7.5, heightIn: 3.875 },
  { id: 'num8_625', name: '#8⅝', group: 'US commercial', widthIn: 8.625, heightIn: 3.625 },
  { id: 'num9', name: '#9', group: 'US commercial', widthIn: 8.875, heightIn: 3.875 },
  { id: 'num10', name: '#10', group: 'US commercial', widthIn: 9.5, heightIn: 4.125 },
  { id: 'num11', name: '#11', group: 'US commercial', widthIn: 10.375, heightIn: 4.5 },
  { id: 'num12', name: '#12', group: 'US commercial', widthIn: 11, heightIn: 4.75 },
  { id: 'num14', name: '#14', group: 'US commercial', widthIn: 11.5, heightIn: 5 },

  { id: 'a1', name: 'A1', group: 'Announcement', widthIn: 5.125, heightIn: 3.625 },
  { id: 'a2', name: 'A2', group: 'Announcement', widthIn: 5.75, heightIn: 4.375 },
  { id: 'a6', name: 'A6', group: 'Announcement', widthIn: 6.5, heightIn: 4.75 },
  { id: 'a7', name: 'A7', group: 'Announcement', widthIn: 7.25, heightIn: 5.25 },
  { id: 'a8', name: 'A8', group: 'Announcement', widthIn: 8.125, heightIn: 5.5 },
  { id: 'a9', name: 'A9', group: 'Announcement', widthIn: 8.75, heightIn: 5.75 },
  { id: 'a10', name: 'A10', group: 'Announcement', widthIn: 9.5, heightIn: 6 },

  { id: 'bar4', name: '4-bar', group: 'Baronial', widthIn: 5.125, heightIn: 3.625 },
  { id: 'bar5_5', name: '5½-bar', group: 'Baronial', widthIn: 5.75, heightIn: 4.375 },
  { id: 'bar6', name: '6-bar', group: 'Baronial', widthIn: 6.5, heightIn: 4.75 },

  { id: 'six_nine', name: '6×9 booklet', group: 'Booklet and catalog', widthIn: 9, heightIn: 6 },
  { id: 'nine_twelve', name: '9×12 catalog', group: 'Booklet and catalog', widthIn: 12, heightIn: 9 },
  { id: 'ten_thirteen', name: '10×13 catalog', group: 'Booklet and catalog', widthIn: 13, heightIn: 10 },

  { id: 'dl', name: 'DL', group: 'International', widthIn: 8.66, heightIn: 4.33, unit: 'mm' },
  { id: 'c6', name: 'C6', group: 'International', widthIn: 6.38, heightIn: 4.49, unit: 'mm' },
  { id: 'c6c5', name: 'C6/C5', group: 'International', widthIn: 9.02, heightIn: 4.49, unit: 'mm' },
  { id: 'c5', name: 'C5', group: 'International', widthIn: 9.02, heightIn: 6.38, unit: 'mm' },
  { id: 'c4', name: 'C4', group: 'International', widthIn: 12.76, heightIn: 9.02, unit: 'mm' },
  { id: 'b6', name: 'B6', group: 'International', widthIn: 6.93, heightIn: 4.92, unit: 'mm' },
  { id: 'b5', name: 'B5', group: 'International', widthIn: 9.84, heightIn: 6.93, unit: 'mm' },

  { id: 'sq5', name: '5 inch square', group: 'Square', widthIn: 5, heightIn: 5 },
  { id: 'sq5_5', name: '5½ inch square', group: 'Square', widthIn: 5.5, heightIn: 5.5 },
  { id: 'sq6', name: '6 inch square', group: 'Square', widthIn: 6, heightIn: 6 },
  { id: 'sq6_5', name: '6½ inch square', group: 'Square', widthIn: 6.5, heightIn: 6.5 },
  { id: 'sq7', name: '7 inch square', group: 'Square', widthIn: 7, heightIn: 7 },
];

export const DEFAULT_ENVELOPE_SIZE: EnvelopeSizeId = 'num10';

export const CUSTOM_MIN_IN = 3;
export const CUSTOM_MAX_IN = 20;

export const MM_PER_IN = 25.4;

export function inchesToMm(v: number): number {
  return v * MM_PER_IN;
}

export function mmToInches(v: number): number {
  return v / MM_PER_IN;
}
const EIGHTHS = ['', '⅛', '¼', '⅜', '½', '⅝', '¾', '⅞'];

export function getEnvelopeSize(id: EnvelopeSizeId): EnvelopeSize {
  const found = ENVELOPE_SIZES.find((s) => s.id === id);
  if (!found) throw new Error(`Unknown envelope size: ${id}`);
  return found;
}

/** Inches as whole + vulgar fraction when an exact eighth, else up to two decimals. */
function formatInches(value: number): string {
  const eighths = value * 8;
  if (Number.isInteger(eighths)) {
    const whole = Math.floor(eighths / 8);
    const frac = EIGHTHS[eighths % 8];
    if (whole === 0 && frac !== '') return frac;
    return `${whole}${frac}`;
  }
  return value.toFixed(2).replace(/\.?0+$/, '');
}

/** Label such as `#10 · 4⅛ × 9½ in` or `DL · 110 × 220 mm` (height first). */
export function formatSizeLabel(size: EnvelopeSize): string {
  if (size.unit === 'mm') {
    const h = Math.round(inchesToMm(size.heightIn));
    const w = Math.round(inchesToMm(size.widthIn));
    return `${size.name} · ${h} × ${w} mm`;
  }
  return `${size.name} · ${formatInches(size.heightIn)} × ${formatInches(size.widthIn)} in`;
}

/** Clamp a custom side length to CUSTOM_MIN_IN..CUSTOM_MAX_IN; non-numbers become the minimum. */
export function clampCustomInches(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return CUSTOM_MIN_IN;
  return Math.min(CUSTOM_MAX_IN, Math.max(CUSTOM_MIN_IN, value));
}

export function resolveEnvelopeSize(settings: {
  size: EnvelopeSizeId | 'custom';
  customWidthIn?: number;
  customHeightIn?: number;
}): { widthIn: number; heightIn: number } {
  if (settings.size === 'custom') {
    return {
      widthIn: clampCustomInches(settings.customWidthIn),
      heightIn: clampCustomInches(settings.customHeightIn),
    };
  }
  const { widthIn, heightIn } = getEnvelopeSize(settings.size);
  return { widthIn, heightIn };
}
