import type { EnvelopeSettings } from '../envelopes/build';
import { DEFAULT_ENVELOPE_SIZE, ENVELOPE_SIZES, clampCustomInches, getEnvelopeSize } from '../envelopes/sizes';
import {
  defaultRecipientLayout, defaultReturnLayout, type BlockLayout, type HAnchor, type VAnchor,
} from '../envelopes/layout';
import type { FontRef } from '../fonts/types';
import { getBundledFont } from '../fonts/catalog';
import { normalizeRich, parseRichText, plainToRich, type RichText } from '../richtext';

export type ThemePreference = 'system' | 'light' | 'dark';

export type AddressTemplate = { lines: string[] };

export type LabelSettings = {
  product: string;
  startAt: number;
  font: 'sans' | 'serif';
  fontSize: number;
};

export type LetterTemplate = { id: string; name: string; html: string };

/**
 * Version 3 files may lack `mergeTemplate` (it was added without a version bump); they get the
 * default template, as do migrated version 1 and 2 files.
 */
export const PROFILE_VERSION = 3;

/** The merge template a new profile starts with. */
const DEFAULT_MERGE_TEMPLATE = '{{Name}}\n{{Address}}\n{{City}}, {{State}} {{Zip}}';

export type Profile = {
  version: typeof PROFILE_VERSION;
  addressTemplate: AddressTemplate;
  envelope: EnvelopeSettings;
  label: LabelSettings;
  letters: LetterTemplate[];
  /** The recipient block for mail merge, with `{{Field}}` tokens. */
  mergeTemplate: RichText;
  theme: ThemePreference;
};

export const PROFILE_KEY = 'mailmerge.profile';

export const FONT_SIZE_MIN = 6;
export const FONT_SIZE_MAX = 72;

/** Largest nudge offset, in inches, in either direction. */
export const OFFSET_MAX_IN = 10;

/** v1 drew the return address at this fraction of the recipient size. */
const V1_RETURN_SCALE = 0.85;

/** Clamp a font size into [FONT_SIZE_MIN, FONT_SIZE_MAX]; non-finite or non-number values yield `fallback`. */
export function clampFontSize(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, value));
}

/**
 * Clamp a nudge offset to ±OFFSET_MAX_IN and round to 0.001 in, removing float drift from repeated steps.
 * Non-finite or non-number values yield 0.
 */
export function clampOffset(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  const clamped = Math.min(OFFSET_MAX_IN, Math.max(-OFFSET_MAX_IN, v));
  return Math.round(clamped * 1000) / 1000 || 0;
}

export function defaultProfile(): Profile {
  const defaultSize = getEnvelopeSize(DEFAULT_ENVELOPE_SIZE);
  return {
    version: PROFILE_VERSION,
    addressTemplate: {
      lines: ['{{First Name}} {{Last Name}}', '{{Address}}', '{{Address 2}}', '{{City}}, {{State}} {{Zip}}'],
    },
    envelope: {
      size: DEFAULT_ENVELOPE_SIZE,
      customWidthIn: defaultSize.widthIn,
      customHeightIn: defaultSize.heightIn,
      showReturn: true,
      showRecipient: true,
      returnAddress: { lines: [] },
      returnLayout: defaultReturnLayout(),
      recipientLayout: defaultRecipientLayout(),
    },
    label: { product: '5160', startAt: 1, font: 'sans', fontSize: 10 },
    letters: [],
    mergeTemplate: normalizeRich(plainToRich(DEFAULT_MERGE_TEMPLATE)),
    theme: 'system',
  };
}

export function loadProfile(storage?: Storage): Profile {
  try {
    const store = storage ?? globalThis.localStorage;
    const raw = store.getItem(PROFILE_KEY);
    if (raw === null) return defaultProfile();
    return parseProfile(raw);
  } catch {
    // Storage can throw (for example SecurityError when site data is blocked).
    return defaultProfile();
  }
}

export function saveProfile(profile: Profile, storage?: Storage): void {
  try {
    (storage ?? globalThis.localStorage).setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // Persistence is best-effort: blocked or full storage must not break the app.
  }
}

export function serializeProfile(profile: Profile): string {
  return JSON.stringify(profile, null, 2);
}

/**
 * Parse an exported layout file. Older versions migrate step by step: 1 → 2 → 3.
 * Missing sections fall back to defaults; invalid fields fall back one at a time.
 * A missing `mergeTemplate` gets the default; one that is present is validated as rich text.
 */
export function parseProfile(text: string): Profile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That is not a layout file exported by this tool.');
  }
  if (!isObj(data)) {
    throw new Error('That is not a layout file exported by this tool.');
  }
  let obj = data;
  if (obj.version === 1) obj = migrateV1(obj);
  if (obj.version === 2) obj = migrateV2(obj);
  if (obj.version !== PROFILE_VERSION) {
    throw new Error(`Unsupported layout file version: ${String(obj.version)}`);
  }
  const d = defaultProfile();
  return {
    version: PROFILE_VERSION,
    addressTemplate: isObj(obj.addressTemplate) && Array.isArray(obj.addressTemplate.lines)
      ? { lines: obj.addressTemplate.lines.map(String) }
      : d.addressTemplate,
    envelope: isObj(obj.envelope) ? parseEnvelope(obj.envelope, d.envelope) : d.envelope,
    label: isObj(obj.label) ? parseLabel(obj.label, d.label) : d.label,
    letters: Array.isArray(obj.letters) ? obj.letters.filter(isLetter) : d.letters,
    mergeTemplate: obj.mergeTemplate === undefined ? d.mergeTemplate : parseRichText(obj.mergeTemplate),
    theme: obj.theme === 'light' || obj.theme === 'dark' ? obj.theme : 'system',
  };
}

/**
 * Turn a version 1 file into version 2 data (still unvalidated).
 * v1 had one font ('sans' | 'serif') and one size for both blocks; the return address used 85% of it.
 */
function migrateV1(obj: Record<string, unknown>): Record<string, unknown> {
  if (!isObj(obj.envelope)) return { ...obj, version: 2 };
  const { font, fontSize, ...rest } = obj.envelope;
  const ref: FontRef = font === 'serif' ? { kind: 'standard', id: 'times' } : { kind: 'standard', id: 'helvetica' };
  const recipientSize = clampFontSize(fontSize, defaultRecipientLayout().fontSize);
  const returnSize = clampFontSize(Math.round(recipientSize * V1_RETURN_SCALE), defaultReturnLayout().fontSize);
  return {
    ...obj,
    version: 2,
    envelope: {
      ...rest,
      returnLayout: { ...defaultReturnLayout(), font: ref, fontSize: returnSize },
      recipientLayout: { ...defaultRecipientLayout(), font: ref, fontSize: recipientSize },
    },
  };
}

/**
 * Turn a version 2 file into version 3 data (still unvalidated).
 * v2 kept the return address as plain text; v3 keeps rich text, normalized like the editor saves it.
 */
function migrateV2(obj: Record<string, unknown>): Record<string, unknown> {
  if (!isObj(obj.envelope)) return { ...obj, version: 3 };
  const { returnAddress } = obj.envelope;
  return {
    ...obj,
    version: 3,
    envelope: {
      ...obj.envelope,
      returnAddress: typeof returnAddress === 'string' ? normalizeRich(plainToRich(returnAddress)) : returnAddress,
    },
  };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v !== '';
}

function parseCustomInches(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? clampCustomInches(v) : fallback;
}

function parseEnvelope(v: Record<string, unknown>, d: EnvelopeSettings): EnvelopeSettings {
  return {
    size: v.size === 'custom' ? 'custom' : ENVELOPE_SIZES.find((s) => s.id === v.size)?.id ?? d.size,
    customWidthIn: parseCustomInches(v.customWidthIn, d.customWidthIn),
    customHeightIn: parseCustomInches(v.customHeightIn, d.customHeightIn),
    showReturn: typeof v.showReturn === 'boolean' ? v.showReturn : d.showReturn,
    showRecipient: typeof v.showRecipient === 'boolean' ? v.showRecipient : d.showRecipient,
    returnAddress: v.returnAddress === undefined ? d.returnAddress : parseRichText(v.returnAddress),
    returnLayout: parseLayout(v.returnLayout, d.returnLayout),
    recipientLayout: parseLayout(v.recipientLayout, d.recipientLayout),
  };
}

const H_ANCHORS: readonly HAnchor[] = ['left', 'center', 'right'];
const V_ANCHORS: readonly VAnchor[] = ['top', 'middle', 'bottom'];

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback;
}

function parseOffset(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? clampOffset(v) : fallback;
}

/** A valid FontRef, or null. Bundled ids must exist in the catalog; their family comes from it. */
function parseFontRef(v: unknown): FontRef | null {
  if (!isObj(v)) return null;
  switch (v.kind) {
    case 'standard':
      return v.id === 'helvetica' || v.id === 'times' ? { kind: 'standard', id: v.id } : null;
    case 'bundled': {
      const font = typeof v.id === 'string' ? getBundledFont(v.id) : undefined;
      return font ? { kind: 'bundled', id: font.id, family: font.family } : null;
    }
    case 'google':
      return isNonEmptyString(v.family) ? { kind: 'google', family: v.family } : null;
    case 'local':
      return isNonEmptyString(v.postscriptName) && isNonEmptyString(v.family)
        ? { kind: 'local', postscriptName: v.postscriptName, family: v.family }
        : null;
    default:
      return null;
  }
}

function parseLayout(input: unknown, d: BlockLayout): BlockLayout {
  if (!isObj(input)) return d;
  return {
    font: parseFontRef(input.font) ?? d.font,
    fontSize: clampFontSize(input.fontSize, d.fontSize),
    align: oneOf(input.align, H_ANCHORS, d.align),
    anchorH: oneOf(input.anchorH, H_ANCHORS, d.anchorH),
    anchorV: oneOf(input.anchorV, V_ANCHORS, d.anchorV),
    offsetX: parseOffset(input.offsetX, d.offsetX),
    offsetY: parseOffset(input.offsetY, d.offsetY),
  };
}

function parseLabel(v: Record<string, unknown>, d: LabelSettings): LabelSettings {
  return {
    product: typeof v.product === 'string' ? v.product : d.product,
    startAt: typeof v.startAt === 'number' && Number.isInteger(v.startAt) && v.startAt >= 1 ? v.startAt : d.startAt,
    font: v.font === 'serif' ? 'serif' : 'sans',
    fontSize: clampFontSize(v.fontSize, d.fontSize),
  };
}

function isLetter(v: unknown): v is LetterTemplate {
  return isObj(v) && typeof v.id === 'string' && typeof v.name === 'string' && typeof v.html === 'string';
}
