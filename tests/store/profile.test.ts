import { describe, it, expect } from 'vitest';
import {
  defaultProfile, loadProfile, saveProfile, serializeProfile, parseProfile, PROFILE_KEY,
  clampFontSize, clampOffset, FONT_SIZE_MIN, FONT_SIZE_MAX, OFFSET_MAX_IN,
  type Profile,
} from '../../src/lib/store/profile';
import type { RichText } from '../../src/lib/richtext';
import { defaultRecipientLayout, defaultReturnLayout, type BlockLayout } from '../../src/lib/envelopes/layout';

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}

describe('profile store', () => {
  it('loads defaults when nothing is stored', () => {
    const p = loadProfile(memoryStorage());
    expect(p).toEqual(defaultProfile());
    expect(p.envelope.size).toBe('num10');
    expect(p.theme).toBe('system');
  });

  it('round-trips through save and load', () => {
    const s = memoryStorage();
    const p: Profile = { ...defaultProfile(), theme: 'dark' };
    p.envelope.returnAddress = {
      lines: [{ runs: [{ text: 'First Church', bold: true }], size: 14 }, { runs: [{ text: '1 Chapel Rd' }] }],
    };
    saveProfile(p, s);
    expect(s.getItem(PROFILE_KEY)).not.toBeNull();
    expect(loadProfile(s)).toEqual(p);
  });

  it('falls back to defaults on corrupt storage', () => {
    const s = memoryStorage();
    s.setItem(PROFILE_KEY, '{not json');
    expect(loadProfile(s)).toEqual(defaultProfile());
  });

  it('serializes to pretty JSON and parses back', () => {
    const p = defaultProfile();
    p.envelope.recipientLayout.fontSize = 14;
    const text = serializeProfile(p);
    expect(text).toContain('\n');
    expect(parseProfile(text)).toEqual(p);
  });

  it('fills missing sections with defaults when parsing a partial file', () => {
    const p = parseProfile(JSON.stringify({ version: 2, theme: 'light' }));
    expect(p.theme).toBe('light');
    expect(p.envelope).toEqual(defaultProfile().envelope);
  });

  it('rejects files with the wrong version or shape', () => {
    expect(() => parseProfile(JSON.stringify({ version: 4 }))).toThrow(/version/i);
    expect(() => parseProfile(JSON.stringify({ version: 0 }))).toThrow(/version/i);
    expect(() => parseProfile(JSON.stringify({}))).toThrow(/version/i);
    expect(() => parseProfile('[]')).toThrow(/layout file/i);
    expect(() => parseProfile('nope')).toThrow(/layout file/i);
  });

  it('validates imported fields against defaults', () => {
    const d = defaultProfile();
    const p = parseProfile(JSON.stringify({
      version: 2,
      envelope: { size: 'bogus', showReturn: 'false', returnAddress: 5, recipientLayout: 'big' },
      label: { startAt: 0, fontSize: 400 },
      letters: [{ id: 1 }, { id: 'a', name: 'b', html: '<p>c</p>' }],
    }));
    expect(p.envelope).toEqual(d.envelope);
    expect(p.label.startAt).toBe(d.label.startAt);
    // Out-of-range numeric sizes are clamped rather than replaced with the default.
    expect(p.label.fontSize).toBe(FONT_SIZE_MAX);
    expect(p.letters).toEqual([{ id: 'a', name: 'b', html: '<p>c</p>' }]);
  });

  it('clamps font sizes into the supported range', () => {
    expect(clampFontSize(NaN, 12)).toBe(12);
    expect(clampFontSize('14', 12)).toBe(12);
    expect(clampFontSize(1, 12)).toBe(FONT_SIZE_MIN);
    expect(clampFontSize(400, 12)).toBe(FONT_SIZE_MAX);
    expect(clampFontSize(18, 12)).toBe(18);
  });

  it('returns defaults when reading storage throws', () => {
    const s = { ...memoryStorage(), getItem: () => { throw new Error('SecurityError'); } } as Storage;
    expect(loadProfile(s)).toEqual(defaultProfile());
  });

  it('does not propagate errors from setItem', () => {
    const s = { ...memoryStorage(), setItem: () => { throw new Error('QuotaExceeded'); } } as Storage;
    expect(() => saveProfile(defaultProfile(), s)).not.toThrow();
  });
});

describe('profile version 2', () => {
  it('defaults to version 3 with per-block layouts', () => {
    const p = defaultProfile();
    expect(p.version).toBe(3);
    expect(p.envelope).toEqual({
      size: 'num10',
      customWidthIn: 9.5,
      customHeightIn: 4.125,
      showReturn: true,
      showRecipient: true,
      returnAddress: { lines: [] },
      returnLayout: defaultReturnLayout(),
      recipientLayout: defaultRecipientLayout(),
    });
  });

  it('migrates a version 1 file', () => {
    const p = parseProfile(JSON.stringify({
      version: 1,
      envelope: { size: 'a7', showReturn: false, returnAddress: 'X', font: 'serif', fontSize: 14 },
      label: { product: '5163', startAt: 3, font: 'serif', fontSize: 11 },
      theme: 'dark',
    }));
    const times = { kind: 'standard', id: 'times' };
    expect(p.version).toBe(3);
    expect(p.theme).toBe('dark');
    expect(p.envelope.size).toBe('a7');
    expect(p.envelope.showReturn).toBe(false);
    expect(p.envelope.showRecipient).toBe(true);
    expect(p.envelope.returnAddress).toEqual({ lines: [{ runs: [{ text: 'X' }] }] });
    expect(p.envelope.recipientLayout).toEqual({ ...defaultRecipientLayout(), font: times, fontSize: 14 });
    expect(p.envelope.returnLayout).toEqual({ ...defaultReturnLayout(), font: times, fontSize: 12 });
    expect(p.label).toEqual({ product: '5163', startAt: 3, font: 'serif', fontSize: 11 });
  });

  it('migrates version 1 sans and default sizes to the current defaults', () => {
    const p = parseProfile(JSON.stringify({
      version: 1,
      envelope: { size: 'num10', showReturn: true, returnAddress: '', font: 'sans', fontSize: 12 },
    }));
    expect(p.envelope).toEqual(defaultProfile().envelope);
  });

  it('migrates invalid version 1 envelope fields to defaults', () => {
    const p = parseProfile(JSON.stringify({
      version: 1,
      envelope: { size: 'bogus', fontSize: '14', showReturn: 'false', font: 'comic' },
    }));
    expect(p.envelope).toEqual(defaultProfile().envelope);
  });

  it('keeps the migrated return size in range', () => {
    const p = parseProfile(JSON.stringify({ version: 1, envelope: { fontSize: 6 } }));
    expect(p.envelope.recipientLayout.fontSize).toBe(6);
    expect(p.envelope.returnLayout.fontSize).toBe(FONT_SIZE_MIN);
  });

  it('round-trips a customized profile', () => {
    const p = defaultProfile();
    p.envelope = {
      size: 'custom',
      customWidthIn: 7,
      customHeightIn: 5,
      showReturn: true,
      showRecipient: true,
      returnAddress: { lines: [{ runs: [{ text: 'First ' }, { text: 'Church', italic: true }] }] },
      returnLayout: {
        font: { kind: 'local', postscriptName: 'Arial-Regular', family: 'Arial' },
        fontSize: 9, align: 'right', anchorH: 'right', anchorV: 'bottom', offsetX: -0.25, offsetY: 0.1,
      },
      recipientLayout: {
        font: { kind: 'google', family: 'Inter' },
        fontSize: 16, align: 'center', anchorH: 'center', anchorV: 'top', offsetX: 1.5, offsetY: -2,
      },
    };
    expect(parseProfile(serializeProfile(p))).toEqual(p);
  });

  it('defaults showRecipient to true', () => {
    expect(defaultProfile().envelope.showRecipient).toBe(true);
  });

  it('defaults showRecipient to true for a version 2 file without it', () => {
    const p = parseProfile(JSON.stringify({ version: 2, envelope: { showReturn: false } }));
    expect(p.envelope.showRecipient).toBe(true);
  });

  it('falls back to true when showRecipient is not a boolean', () => {
    const p = parseProfile(JSON.stringify({ version: 2, envelope: { showRecipient: 'no' } }));
    expect(p.envelope.showRecipient).toBe(true);
  });

  it('round-trips showRecipient false', () => {
    const p = defaultProfile();
    p.envelope = { ...p.envelope, showRecipient: false };
    const parsed = parseProfile(serializeProfile(p));
    expect(parsed.envelope.showRecipient).toBe(false);
    expect(parsed).toEqual(p);
  });

  it('accepts each font kind', () => {
    const fonts = [
      { kind: 'standard', id: 'times' },
      { kind: 'bundled', id: 'lora', family: 'Lora' },
      { kind: 'google', family: 'Inter' },
      { kind: 'local', postscriptName: 'ArialMT', family: 'Arial' },
    ];
    for (const font of fonts) {
      const p = parseProfile(JSON.stringify({ version: 2, envelope: { recipientLayout: { font } } }));
      expect(p.envelope.recipientLayout.font).toEqual(font);
    }
  });

  it('fills the family of a bundled font from the catalog', () => {
    const p = parseProfile(JSON.stringify({
      version: 2, envelope: { recipientLayout: { font: { kind: 'bundled', id: 'eb-garamond', family: 7 } } },
    }));
    expect(p.envelope.recipientLayout.font).toEqual({ kind: 'bundled', id: 'eb-garamond', family: 'EB Garamond' });
  });

  it('rejects malformed font references', () => {
    const bad = [
      { kind: 'google' },
      { kind: 'google', family: '' },
      { kind: 'standard', id: 'courier' },
      { kind: 'bundled', id: 'not-a-bundled-font' },
      { kind: 'local', family: 'Arial' },
      { kind: 'woff', family: 'X' },
      'helvetica',
    ];
    for (const font of bad) {
      const p = parseProfile(JSON.stringify({ version: 2, envelope: { recipientLayout: { font } } }));
      expect(p.envelope.recipientLayout.font, JSON.stringify(font)).toEqual(defaultRecipientLayout().font);
    }
  });

  it('falls back field by field for invalid layout values', () => {
    const p = parseProfile(JSON.stringify({
      version: 2,
      envelope: {
        recipientLayout: {
          anchorH: 'middle', anchorV: 'left', align: 'justify', offsetX: 'far', offsetY: 0.5,
          fontSize: 400, font: { kind: 'google' },
        },
      },
    }));
    const d = defaultRecipientLayout();
    const expected: BlockLayout = { ...d, offsetY: 0.5, fontSize: FONT_SIZE_MAX };
    expect(p.envelope.recipientLayout).toEqual(expected);
  });

  it('clamps offsets to ten inches either way', () => {
    const p = parseProfile(JSON.stringify({
      version: 2, envelope: { returnLayout: { offsetX: 50, offsetY: -50 } },
    }));
    expect(p.envelope.returnLayout.offsetX).toBe(10);
    expect(p.envelope.returnLayout.offsetY).toBe(-10);
  });

  it('accepts the custom size and clamps custom dimensions to 3–20 in', () => {
    const p = parseProfile(JSON.stringify({
      version: 2, envelope: { size: 'custom', customWidthIn: 25, customHeightIn: 1 },
    }));
    expect(p.envelope.size).toBe('custom');
    expect(p.envelope.customWidthIn).toBe(20);
    expect(p.envelope.customHeightIn).toBe(3);
  });

  it('uses default custom dimensions when they are not numbers', () => {
    const d = defaultProfile().envelope;
    const p = parseProfile(JSON.stringify({
      version: 2, envelope: { customWidthIn: 'wide', customHeightIn: null },
    }));
    expect(p.envelope.customWidthIn).toBe(d.customWidthIn);
    expect(p.envelope.customHeightIn).toBe(d.customHeightIn);
  });

  it('loads a stored version 1 profile as version 3', () => {
    const s = memoryStorage();
    s.setItem(PROFILE_KEY, JSON.stringify({ version: 1, envelope: { font: 'serif', fontSize: 14 }, theme: 'light' }));
    const p = loadProfile(s);
    expect(p.version).toBe(3);
    expect(p.theme).toBe('light');
    expect(p.envelope.recipientLayout.font).toEqual({ kind: 'standard', id: 'times' });
  });
});

describe('profile version 3', () => {
  const v2Fixture = {
    version: 2,
    envelope: {
      size: 'a7',
      customWidthIn: 7,
      customHeightIn: 5,
      showReturn: true,
      showRecipient: false,
      returnAddress: '\n  First Church  \n\n1 Chapel Rd\r\nSpringfield, IL 62701\n\n',
      returnLayout: { ...defaultReturnLayout(), font: { kind: 'bundled', id: 'lora', family: 'Lora' }, fontSize: 9 },
      recipientLayout: { ...defaultRecipientLayout(), align: 'center' },
    },
    label: { product: '5163', startAt: 2, font: 'serif', fontSize: 11 },
    letters: [],
    theme: 'dark',
  };

  it('migrates a version 2 file, turning the return address into rich text', () => {
    const p = parseProfile(JSON.stringify(v2Fixture));
    expect(p.version).toBe(3);
    expect(p.envelope.returnAddress).toEqual({
      lines: [
        { runs: [{ text: 'First Church' }] },
        { runs: [] },
        { runs: [{ text: '1 Chapel Rd' }] },
        { runs: [{ text: 'Springfield, IL 62701' }] },
      ],
    });
    expect(p.envelope.size).toBe('a7');
    expect(p.envelope.showRecipient).toBe(false);
    expect(p.envelope.returnLayout).toEqual(v2Fixture.envelope.returnLayout);
    expect(p.envelope.recipientLayout).toEqual(v2Fixture.envelope.recipientLayout);
    expect(p.label).toEqual(v2Fixture.label);
    expect(p.theme).toBe('dark');
  });

  it('migrates an empty version 2 return address to empty rich text', () => {
    const p = parseProfile(JSON.stringify({ version: 2, envelope: { returnAddress: '' } }));
    expect(p.envelope.returnAddress).toEqual({ lines: [] });
  });

  it('migrates a non-string version 2 return address to empty rich text', () => {
    const p = parseProfile(JSON.stringify({ version: 2, envelope: { returnAddress: ['First Church'] } }));
    expect(p.envelope.returnAddress).toEqual({ lines: [] });
  });

  it('round-trips a migrated profile as version 3', () => {
    const p = parseProfile(JSON.stringify(v2Fixture));
    expect(parseProfile(serializeProfile(p))).toEqual(p);
  });

  it('keeps valid version 3 rich text', () => {
    const returnAddress: RichText = {
      lines: [
        { runs: [{ text: 'First', bold: true }, { text: ' Church', bold: true, italic: true }], size: 18 },
        { runs: [] },
        { runs: [{ text: '1 Chapel Rd', italic: true }] },
      ],
    };
    const p = parseProfile(JSON.stringify({ version: 3, envelope: { returnAddress } }));
    expect(p.envelope.returnAddress).toEqual(returnAddress);
  });

  it('treats a string return address in a version 3 file as invalid', () => {
    const p = parseProfile(JSON.stringify({ version: 3, envelope: { returnAddress: 'First Church' } }));
    expect(p.envelope.returnAddress).toEqual({ lines: [] });
  });

  it('rejects version 4', () => {
    expect(() => parseProfile(JSON.stringify({ version: 4, envelope: {} }))).toThrow('Unsupported layout file version: 4');
  });
});

describe('clampOffset', () => {
  it('clamps to OFFSET_MAX_IN either way', () => {
    expect(clampOffset(50)).toBe(OFFSET_MAX_IN);
    expect(clampOffset(-50)).toBe(-OFFSET_MAX_IN);
    expect(clampOffset(1.25)).toBe(1.25);
  });

  it('rounds to 0.001 in to remove float drift', () => {
    expect(clampOffset(0.1 + 0.2)).toBe(0.3);
    expect(clampOffset(-0.30000000000000004)).toBe(-0.3);
    expect(clampOffset(1.23456)).toBe(1.235);
  });

  it('returns 0 for non-finite or non-number values', () => {
    expect(clampOffset(Number.NaN)).toBe(0);
    expect(clampOffset(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampOffset('2')).toBe(0);
    expect(clampOffset(undefined)).toBe(0);
  });
});
