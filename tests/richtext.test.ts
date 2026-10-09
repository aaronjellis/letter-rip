import { describe, it, expect } from 'vitest';
import {
  plainToRich,
  richToPlain,
  isRichEmpty,
  normalizeRich,
  htmlToRich,
  richToHtml,
  runStyle,
  sameStyle,
  mergeRuns,
  parseRichText,
  type RichText,
} from '../src/lib/richtext';

/** Rich text samples that survive richToHtml then htmlToRich unchanged. */
const ROUND_TRIP_SAMPLES: RichText[] = [
  { lines: [{ runs: [{ text: 'Jane ' }, { text: 'Doe', bold: true }] }, { runs: [{ text: 'Main', italic: true }, { text: ' St' }], size: 18 }] },
  { lines: [{ runs: [{ text: 'a' }] }, { runs: [] }, { runs: [], size: 24 }, { runs: [{ text: 'A & <B>  "c"' }] }] },
  { lines: [{ runs: [{ text: 'x ', bold: true }, { text: ' y', italic: true }, { text: 'z', bold: true, italic: true }] }] },
];

describe('plainToRich', () => {
  it('keeps every line, including blank ones', () => {
    expect(plainToRich('A\n\nB')).toEqual({
      lines: [{ runs: [{ text: 'A' }] }, { runs: [] }, { runs: [{ text: 'B' }] }],
    });
  });

  it('splits on CRLF too', () => {
    expect(plainToRich('A\r\nB').lines).toHaveLength(2);
  });

  it('gives an empty string one empty line', () => {
    expect(plainToRich('')).toEqual({ lines: [{ runs: [] }] });
  });
});

describe('richToPlain', () => {
  it('joins runs and lines', () => {
    const rich: RichText = {
      lines: [{ runs: [{ text: 'Jane ' }, { text: 'Doe', bold: true }] }, { runs: [{ text: 'Main St' }], size: 18 }],
    };
    expect(richToPlain(rich)).toBe('Jane Doe\nMain St');
  });

  it('round-trips plain text', () => {
    for (const s of ['A\n\nB', 'Jane Doe\n123 Main St\nSpringfield, IL 62704', '', '  x  ']) {
      expect(richToPlain(plainToRich(s))).toBe(s);
    }
  });
});

describe('normalizeRich', () => {
  it('merges adjacent runs with equal style', () => {
    expect(
      normalizeRich({ lines: [{ runs: [{ text: 'a', bold: true }, { text: 'b', bold: true }] }] }),
    ).toEqual({ lines: [{ runs: [{ text: 'ab', bold: true }] }] });
  });

  it('treats false and missing style flags as equal and drops false flags', () => {
    expect(
      normalizeRich({ lines: [{ runs: [{ text: 'a', bold: false, italic: false }, { text: 'b' }] }] }),
    ).toEqual({ lines: [{ runs: [{ text: 'ab' }] }] });
  });

  it('drops empty runs', () => {
    expect(
      normalizeRich({ lines: [{ runs: [{ text: 'a' }, { text: '', bold: true }, { text: 'b' }] }] }),
    ).toEqual({ lines: [{ runs: [{ text: 'ab' }] }] });
  });

  it('trims line-outer whitespace and keeps interior spaces between runs', () => {
    expect(
      normalizeRich({
        lines: [{ runs: [{ text: '  Jane ' }, { text: 'Doe', bold: true }, { text: ' ' }, { text: 'Jr  ', italic: true }] }],
      }),
    ).toEqual({ lines: [{ runs: [{ text: 'Jane ' }, { text: 'Doe', bold: true }, { text: ' ' }, { text: 'Jr', italic: true }] }] });
  });

  it('drops runs that become empty after trimming', () => {
    expect(
      normalizeRich({ lines: [{ runs: [{ text: '  ', bold: true }, { text: 'x' }, { text: ' ', italic: true }] }] }),
    ).toEqual({ lines: [{ runs: [{ text: 'x' }] }] });
  });

  it('drops leading and trailing empty lines and keeps interior ones', () => {
    expect(normalizeRich(plainToRich('\n  \nA\n\n \nB\n\n'))).toEqual({
      lines: [{ runs: [{ text: 'A' }] }, { runs: [] }, { runs: [] }, { runs: [{ text: 'B' }] }],
    });
  });

  it('clamps size to 6–72', () => {
    const n = normalizeRich({
      lines: [
        { runs: [{ text: 'a' }], size: 2 },
        { runs: [{ text: 'b' }], size: 100 },
        { runs: [{ text: 'c' }], size: 18 },
      ],
    });
    expect(n.lines.map((l) => l.size)).toEqual([6, 72, 18]);
  });

  it('deletes size when undefined or not finite', () => {
    const n = normalizeRich({
      lines: [
        { runs: [{ text: 'a' }], size: undefined },
        { runs: [{ text: 'b' }], size: Number.NaN },
      ],
    });
    for (const l of n.lines) expect('size' in l).toBe(false);
  });

  it('does not mutate its input', () => {
    const input: RichText = { lines: [{ runs: [{ text: ' a', bold: true }, { text: 'b', bold: true }], size: 99 }] };
    const copy = structuredClone(input);
    normalizeRich(input);
    expect(input).toEqual(copy);
  });

  it('is idempotent', () => {
    const once = normalizeRich(htmlToRich('<div> Jane <b>Doe</b> </div><div><br></div><div data-size="18"><i>Main</i> St</div>'));
    expect(normalizeRich(once)).toEqual(once);
  });

  it('is idempotent across the round-trip samples', () => {
    for (const r of ROUND_TRIP_SAMPLES) {
      const once = normalizeRich(r);
      expect(normalizeRich(once)).toEqual(once);
    }
  });
});

describe('isRichEmpty', () => {
  it('is true for no lines', () => {
    expect(isRichEmpty({ lines: [] })).toBe(true);
  });

  it('is true when every run is whitespace', () => {
    expect(isRichEmpty({ lines: [{ runs: [{ text: '  ' }] }, { runs: [] }, { runs: [{ text: '\t', bold: true }] }] })).toBe(
      true,
    );
  });

  it('is false when any run has text', () => {
    expect(isRichEmpty({ lines: [{ runs: [] }, { runs: [{ text: ' x ' }] }] })).toBe(false);
  });
});

describe('style helpers', () => {
  it('runStyle fills both flags', () => {
    expect(runStyle({ text: 'a' })).toEqual({ bold: false, italic: false });
    expect(runStyle({ text: 'a', bold: true })).toEqual({ bold: true, italic: false });
  });

  it('sameStyle ignores false versus missing', () => {
    expect(sameStyle({ text: 'a', bold: false }, { text: 'b' })).toBe(true);
    expect(sameStyle({ text: 'a', italic: true }, { text: 'b' })).toBe(false);
  });
});

describe('mergeRuns', () => {
  it('concatenates parts, merging neighbors with equal style and dropping empty runs', () => {
    expect(
      mergeRuns(
        [{ text: 'a', bold: true }, { text: '' }],
        [{ text: 'b', bold: true, italic: false }, { text: 'c', italic: true }],
        [],
        [{ text: 'd', italic: true }],
      ),
    ).toEqual([{ text: 'ab', bold: true }, { text: 'cd', italic: true }]);
  });

  it('returns fresh runs without false flags and does not mutate its input', () => {
    const input = [{ text: 'a', bold: false }, { text: 'b' }];
    const copy = structuredClone(input);
    const out = mergeRuns(input);
    expect(out).toEqual([{ text: 'ab' }]);
    expect(input).toEqual(copy);
    expect(mergeRuns([{ text: 'x' }])[0]).not.toBe(input[0]);
  });

  it('returns an empty list for no input', () => {
    expect(mergeRuns()).toEqual([]);
  });
});

describe('htmlToRich', () => {
  it('maps line divs, bold, italic, and data-size', () => {
    expect(htmlToRich('<div>Jane <b>Doe</b></div><div data-size="18"><i>Main</i> St</div>')).toEqual({
      lines: [
        { runs: [{ text: 'Jane ' }, { text: 'Doe', bold: true }] },
        { runs: [{ text: 'Main', italic: true }, { text: ' St' }], size: 18 },
      ],
    });
  });

  it('treats <br> inside a div as a line break', () => {
    expect(htmlToRich('<div>a<br>b</div>')).toEqual({ lines: [{ runs: [{ text: 'a' }] }, { runs: [{ text: 'b' }] }] });
  });

  it('treats a div holding only <br> as one empty line', () => {
    expect(htmlToRich('<div>a</div><div><br></div><div>b</div>')).toEqual({
      lines: [{ runs: [{ text: 'a' }] }, { runs: [] }, { runs: [{ text: 'b' }] }],
    });
  });

  it('ignores a trailing <br> at the end of a line div', () => {
    expect(htmlToRich('<div>a<br></div><div>b</div>')).toEqual({
      lines: [{ runs: [{ text: 'a' }] }, { runs: [{ text: 'b' }] }],
    });
  });

  it('keeps the size of an empty sized line', () => {
    expect(htmlToRich('<div data-size="24"><br></div>')).toEqual({ lines: [{ runs: [], size: 24 }] });
  });

  it('reads loose text before, between, and after line divs as lines', () => {
    expect(htmlToRich('first<div>second</div>third')).toEqual({
      lines: [{ runs: [{ text: 'first' }] }, { runs: [{ text: 'second' }] }, { runs: [{ text: 'third' }] }],
    });
  });

  it('handles nested <b><i>', () => {
    expect(htmlToRich('<b>a<i>b</i></b><i>c</i>')).toEqual({
      lines: [{ runs: [{ text: 'a', bold: true }, { text: 'b', bold: true, italic: true }, { text: 'c', italic: true }] }],
    });
  });

  it('accepts <strong> and <em> as aliases', () => {
    expect(htmlToRich('<strong>a</strong><em>b</em>')).toEqual({
      lines: [{ runs: [{ text: 'a', bold: true }, { text: 'b', italic: true }] }],
    });
  });

  it('treats font-weight and font-style in a span style as bold and italic', () => {
    expect(
      htmlToRich('<span style="font-weight:bold">a</span><span style="font-weight: 700; font-style: italic">b</span>'),
    ).toEqual({ lines: [{ runs: [{ text: 'a', bold: true }, { text: 'b', bold: true, italic: true }] }] });
  });

  it('lets an inline font-weight:normal cancel <b>', () => {
    expect(htmlToRich('<b style="font-weight:normal">a<b>b</b></b>')).toEqual({
      lines: [{ runs: [{ text: 'a' }, { text: 'b', bold: true }] }],
    });
  });

  it('unwraps unknown tags', () => {
    expect(htmlToRich('<div><span class="x"><font face="Arial">Jane</font> <u>Doe</u></span></div>')).toEqual({
      lines: [{ runs: [{ text: 'Jane Doe' }] }],
    });
  });

  it('decodes entities', () => {
    expect(
      richToPlain(htmlToRich('<div>A &amp; B &lt;C&gt; &quot;D&quot; &#39;E&#39; &#x41;&#66; &copy; &bogus;</div>')),
    ).toBe('A & B <C> "D" \'E\' AB © &bogus;');
  });

  it('turns &nbsp; into a space that does not collapse', () => {
    expect(htmlToRich('<div>a&nbsp;&nbsp; b</div>')).toEqual({ lines: [{ runs: [{ text: 'a   b' }] }] });
  });

  it('collapses source whitespace like a browser', () => {
    expect(htmlToRich('<div>\n  Jane\n   <b> Doe </b>\n</div>\n<div>b</div>')).toEqual({
      lines: [{ runs: [{ text: 'Jane ' }, { text: 'Doe', bold: true }] }, { runs: [{ text: 'b' }] }],
    });
  });

  it('treats p and li as lines', () => {
    expect(richToPlain(htmlToRich('<p>a</p><ul><li>b</li><li>c</li></ul>'))).toBe('a\nb\nc');
  });

  it('skips script, style, and comments', () => {
    expect(
      richToPlain(htmlToRich('<style>p{color:red}</style><!-- note --><div>a<script>alert("<b>x</b>")</script></div>')),
    ).toBe('a');
  });

  it('skips raw-text elements closed with a different case', () => {
    expect(richToPlain(htmlToRich('<div>a<SCRIPT>alert("<b>x</b>")</Script>b</div>'))).toBe('ab');
  });

  it('keeps tags after raw text preceded by characters whose lowercase changes length', () => {
    expect(htmlToRich('İİİİİİİİİ<style>a</style><b>x</b>')).toEqual({
      lines: [{ runs: [{ text: 'İİİİİİİİİ' }, { text: 'x', bold: true }] }],
    });
  });

  it('parses a 100 KB paste of repeated <style> elements quickly', () => {
    const html = '<style>x</style>'.repeat(Math.ceil(100_000 / 16)) + 'done';
    const start = performance.now();
    expect(richToPlain(htmlToRich(html))).toBe('done');
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it('handles 20,000 unclosed spans and 20,000 unmatched end tags quickly', () => {
    const html = '<span>'.repeat(20_000) + 'text' + '</x>'.repeat(20_000);
    const start = performance.now();
    expect(richToPlain(htmlToRich(html))).toBe('text');
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it('still styles text inside deeply nested elements up to the depth cap', () => {
    expect(htmlToRich('<span>'.repeat(100) + '<b>x</b>')).toEqual({ lines: [{ runs: [{ text: 'x', bold: true }] }] });
  });

  it('keeps a stray < that does not start a tag', () => {
    expect(richToPlain(htmlToRich('<div>1 < 2</div>'))).toBe('1 < 2');
  });

  it('reads uppercase tags and quoted attributes containing >', () => {
    expect(htmlToRich('<DIV TITLE="a>b" DATA-SIZE=\'14\'><B>x</B></DIV>')).toEqual({
      lines: [{ runs: [{ text: 'x', bold: true }], size: 14 }],
    });
  });

  it('puts table rows on lines and separates cells with a space', () => {
    expect(richToPlain(htmlToRich('<table><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></table>'))).toBe('a b\nc');
  });

  it('recovers from misnested tags', () => {
    expect(htmlToRich('<b>a<i>b</b>c</i>d')).toEqual({
      lines: [{ runs: [{ text: 'a', bold: true }, { text: 'b', bold: true, italic: true }, { text: 'cd' }] }],
    });
  });

  it('ignores a data-size that is not a number and clamps one out of range', () => {
    expect(htmlToRich('<div data-size="big">a</div><div data-size="200">b</div>')).toEqual({
      lines: [{ runs: [{ text: 'a' }] }, { runs: [{ text: 'b' }], size: 72 }],
    });
  });

  it('returns no lines for empty input', () => {
    expect(htmlToRich('')).toEqual({ lines: [] });
    expect(htmlToRich('<div></div>')).toEqual({ lines: [] });
  });
});

describe('richToHtml', () => {
  it('emits one div per line with b and i', () => {
    expect(
      richToHtml({ lines: [{ runs: [{ text: 'Jane ' }, { text: 'Doe', bold: true }] }, { runs: [{ text: 'x', bold: true, italic: true }] }] }),
    ).toBe('<div>Jane <b>Doe</b></div><div><b><i>x</i></b></div>');
  });

  it('escapes < and &', () => {
    expect(richToHtml({ lines: [{ runs: [{ text: 'A & <B>' }] }] })).toBe('<div>A &amp; &lt;B&gt;</div>');
  });

  it('emits data-size plus an inline font-size', () => {
    expect(richToHtml({ lines: [{ runs: [{ text: 'Main' }], size: 18 }] })).toBe(
      '<div data-size="18" style="font-size:18pt">Main</div>',
    );
  });

  it('gives an empty line a <br> so it keeps its height', () => {
    expect(richToHtml({ lines: [{ runs: [] }] })).toBe('<div><br></div>');
  });

  it('protects spaces a browser would collapse', () => {
    expect(richToHtml({ lines: [{ runs: [{ text: ' a  b ' }] }] })).toBe('<div>&nbsp;a &nbsp;b&nbsp;</div>');
  });

  it('returns an empty string for no lines', () => {
    expect(richToHtml({ lines: [] })).toBe('');
  });

  it('round-trips through htmlToRich', () => {
    for (const r of ROUND_TRIP_SAMPLES) expect(htmlToRich(richToHtml(r))).toEqual(r);
  });

  it('never emits markup from a size that is not a number', () => {
    const payload = '"><img src=x onerror=alert(1)>';
    const html = richToHtml({ lines: [{ runs: [{ text: 'a' }], size: payload as unknown as number }] });
    expect(html).not.toContain('<img');
    expect(html).not.toContain('"><');
    expect(html).toBe('<div>a</div>');
  });

  it('emits no size attributes for a non-finite size', () => {
    expect(richToHtml({ lines: [{ runs: [{ text: 'a' }], size: Number.NaN }] })).toBe('<div>a</div>');
    expect(richToHtml({ lines: [{ runs: [{ text: 'a' }], size: Number.POSITIVE_INFINITY }] })).toBe('<div>a</div>');
  });

  it('clamps an out-of-range size at output time', () => {
    expect(richToHtml({ lines: [{ runs: [{ text: 'a' }], size: 500 }] })).toBe(
      '<div data-size="72" style="font-size:72pt">a</div>',
    );
  });
});

describe('parseRichText', () => {
  it('returns empty rich text for garbage', () => {
    for (const bad of [null, undefined, 'text', 5, [], {}, { lines: 'x' }, { lines: null }]) {
      expect(parseRichText(bad), JSON.stringify(bad)).toEqual({ lines: [] });
    }
  });

  it('drops lines that are not objects with a runs array', () => {
    expect(parseRichText({
      lines: [null, 'a', { runs: 'x' }, {}, { runs: [{ text: 'kept' }] }],
    })).toEqual({ lines: [{ runs: [{ text: 'kept' }] }] });
  });

  it('drops runs without string text or with non-boolean flags', () => {
    expect(parseRichText({
      lines: [{
        runs: [
          { text: 'a' }, { text: 5 }, null, 'b', { bold: true },
          { text: 'c', bold: 'yes' }, { text: 'd', italic: 1 }, { text: 'e', bold: true, italic: false },
        ],
      }],
    })).toEqual({ lines: [{ runs: [{ text: 'a' }, { text: 'e', bold: true }] }] });
  });

  it('strips unknown keys from lines and runs', () => {
    expect(parseRichText({
      lines: [{ runs: [{ text: 'a', color: 'red' }], align: 'center' }], extra: 1,
    })).toEqual({ lines: [{ runs: [{ text: 'a' }] }] });
  });

  it('clamps line sizes to 6–72 and drops sizes that are not finite numbers', () => {
    const line = (size: unknown) => ({ runs: [{ text: 'a' }], size });
    expect(parseRichText({ lines: [line(3), line(100), line(14.5), line('18'), line(null)] })).toEqual({
      lines: [
        { runs: [{ text: 'a' }], size: 6 },
        { runs: [{ text: 'a' }], size: 72 },
        { runs: [{ text: 'a' }], size: 14.5 },
        { runs: [{ text: 'a' }] },
        { runs: [{ text: 'a' }] },
      ],
    });
    // JSON turns non-finite numbers into null, but direct input can still carry them.
    expect(parseRichText({ lines: [line(Number.POSITIVE_INFINITY), line(Number.NaN)] })).toEqual({
      lines: [{ runs: [{ text: 'a' }] }, { runs: [{ text: 'a' }] }],
    });
  });
});
