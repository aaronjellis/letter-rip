import { describe, it, expect } from 'vitest';
import {
  TOKEN_RE, tokenRegex, findTokens, renderTemplate, renameTokens, unknownTokens, recordFromRow,
} from '../../src/lib/merge/render';
import { htmlToRich, normalizeRich, plainToRich, richToHtml, richToPlain, type RichText } from '../../src/lib/richtext';

const plain = (s: string) => plainToRich(s);
const render = (template: string, record: Record<string, string>) => richToPlain(renderTemplate(plain(template), record));

const ADDRESS = '{{Name}}\n{{Address}}\n{{Address 2}}\n{{City}}, {{State}} {{Zip}}';
const RECORD = {
  Name: 'Ada Lovelace', Address: '12 St James Sq', 'Address 2': '', City: 'London', State: 'LDN', Zip: 'SW1Y 4JH',
};

describe('TOKEN_RE', () => {
  it('is global and captures the text between the braces', () => {
    expect(TOKEN_RE.flags).toContain('g');
    const names = [...'{{ First Name }} and {{Zip}}'.matchAll(TOKEN_RE)].map((m) => m[1].trim());
    expect(names).toEqual(['First Name', 'Zip']);
  });
});

describe('tokenRegex', () => {
  it('returns a fresh global regex each call, matching like TOKEN_RE', () => {
    const a = tokenRegex();
    const b = tokenRegex();
    expect(a).not.toBe(b);
    expect(a.flags).toContain('g');
    expect(a.source).toBe(TOKEN_RE.source);
    a.exec('{{A}} {{B}}');
    expect(a.lastIndex).toBeGreaterThan(0);
    expect(b.lastIndex).toBe(0);
  });

  it('matches in linear time on an unclosed token followed by many spaces', () => {
    const text = '{{' + ' '.repeat(5000);
    const t0 = performance.now();
    expect([...text.matchAll(tokenRegex())]).toEqual([]);
    expect(findTokens(plain(text))).toEqual([]);
    expect(richToPlain(renderTemplate(plain(text + 'x'), {}))).toBe('{{' + ' '.repeat(5000) + 'x');
    expect(performance.now() - t0).toBeLessThan(50);
  });
});

describe('findTokens', () => {
  it('returns trimmed names in order of first appearance', () => {
    expect(findTokens(plain('{{ Name }}\n{{City}}, {{State}} {{Zip}}'))).toEqual(['Name', 'City', 'State', 'Zip']);
  });

  it('lists each field once, matching case- and space-insensitively', () => {
    expect(findTokens(plain('{{Zip Code}} {{zip  code}} {{Name}} {{ZIP CODE}}'))).toEqual(['Zip Code', 'Name']);
  });

  it('finds tokens across lines and runs but not tokens split between runs', () => {
    const rich: RichText = {
      lines: [
        { runs: [{ text: 'Dear ' }, { text: '{{Name}}', bold: true }] },
        { runs: [{ text: '{{Ci' }, { text: 'ty}}', italic: true }] },
      ],
    };
    expect(findTokens(rich)).toEqual(['Name']);
  });

  it('ignores empty braces and unclosed tokens', () => {
    expect(findTokens(plain('{{}} {{ }} {{Name'))).toEqual([]);
  });
});

describe('renderTemplate', () => {
  it('fills an address block and drops a line whose only token is empty', () => {
    expect(render(ADDRESS, RECORD)).toBe('Ada Lovelace\n12 St James Sq\nLondon, LDN SW1Y 4JH');
  });

  it('matches field names case-insensitively', () => {
    expect(render('{{name}} {{CITY}}', { Name: 'Ada', City: 'London' })).toBe('Ada London');
  });

  it('matches field names ignoring extra and surrounding spaces', () => {
    const record = { 'ZIP Code': '62701' };
    expect(render('{{zip code}}', record)).toBe('62701');
    expect(render('{{ Zip  code }}', record)).toBe('62701');
    expect(render('{{zip code}}', { ' Zip   Code ': '62701' })).toBe('62701');
  });

  it('renders unmatched tokens as empty', () => {
    expect(render('Hello {{Nickname}}!', {})).toBe('Hello !');
  });

  it('keeps unmatched tokens as written with unknownAsEmpty false', () => {
    const out = renderTemplate(plain('{{Name}} {{Nickname}}'), { Name: 'Ada' }, { unknownAsEmpty: false });
    expect(richToPlain(out)).toBe('Ada {{Nickname}}');
  });

  it('removes a token line that renders blank, even with leftover punctuation spaces', () => {
    expect(render('{{Name}}\n{{Address 2}} {{Suite}}\n{{City}}', { Name: 'A', City: 'C' })).toBe('A\nC');
  });

  it('keeps a line with literal text when its token is empty', () => {
    expect(render('{{Name}}\nAttn: {{Contact}}', { Name: 'Acme' })).toBe('Acme\nAttn:');
  });

  it('keeps blank lines that never had a token', () => {
    expect(render('{{Name}}\n\n{{City}}', { Name: 'A', City: 'C' })).toBe('A\n\nC');
  });

  it('removes a token line left with only punctuation when every token is empty', () => {
    expect(render('{{Name}}\n{{City}}, {{State}}', { Name: 'A', City: '', State: '' })).toBe('A');
  });

  it('keeps a token line with a letter or digit in its literal text', () => {
    expect(render('{{Name}}\nAttn: {{Contact}}', { Name: 'Acme', Contact: '' })).toBe('Acme\nAttn:');
    expect(render('{{Name}}\nUnit 4 {{Suite}}', { Name: 'Acme' })).toBe('Acme\nUnit 4');
  });

  it('keeps a line whose token value is punctuation', () => {
    expect(render('{{Name}}\n{{Dash}}', { Name: 'A', Dash: '-' })).toBe('A\n-');
  });

  it('keeps an unknown token line when unknown tokens stay as written', () => {
    const out = renderTemplate(plain('{{Nickname}}'), {}, { unknownAsEmpty: false });
    expect(richToPlain(out)).toBe('{{Nickname}}');
  });

  it('inserts values literally, without re-expanding tokens or $ patterns', () => {
    expect(render('{{Name}}', { Name: '{{City}} $& $1' , City: 'X' })).toBe('{{City}} $& $1');
  });

  it('keeps bold on a token inside a bold run', () => {
    const rich: RichText = { lines: [{ runs: [{ text: 'To: ' }, { text: '{{Name}}', bold: true }] }] };
    expect(renderTemplate(rich, { Name: 'Ada' })).toEqual({
      lines: [{ runs: [{ text: 'To: ' }, { text: 'Ada', bold: true }] }],
    });
  });

  it('preserves styles and sizes around substitutions', () => {
    const rich: RichText = {
      lines: [
        { runs: [{ text: '{{Name}}', bold: true, italic: true }], size: 18 },
        { runs: [{ text: 'c/o ', italic: true }, { text: '{{Company}}' }] },
      ],
    };
    expect(renderTemplate(rich, { name: 'Ada', company: 'Analytical Engines' })).toEqual({
      lines: [
        { runs: [{ text: 'Ada', bold: true, italic: true }], size: 18 },
        { runs: [{ text: 'c/o ', italic: true }, { text: 'Analytical Engines' }] },
      ],
    });
  });

  it('merges runs that end up with the same style and trims lines', () => {
    const rich: RichText = {
      lines: [{ runs: [{ text: '  {{First}} ', bold: true }, { text: '{{Last}}  ', bold: true }] }],
    };
    expect(renderTemplate(rich, { First: 'Ada', Last: 'Lovelace' })).toEqual({
      lines: [{ runs: [{ text: 'Ada Lovelace', bold: true }] }],
    });
  });

  it('leaves a token split across runs as literal text', () => {
    const rich: RichText = { lines: [{ runs: [{ text: '{{Na' }, { text: 'me}}', bold: true }] }] };
    expect(renderTemplate(rich, { Name: 'Ada' })).toEqual({
      lines: [{ runs: [{ text: '{{Na' }, { text: 'me}}', bold: true }] }],
    });
  });

  it('drops a blank token line that carried a size', () => {
    const rich: RichText = {
      lines: [{ runs: [{ text: '{{Name}}' }] }, { runs: [{ text: '{{Title}}', bold: true }], size: 20 }],
    };
    expect(renderTemplate(rich, { Name: 'Ada' })).toEqual({ lines: [{ runs: [{ text: 'Ada' }] }] });
  });

  it('returns normalized output and does not change the template', () => {
    const rich = plain('\n{{Name}}\n\n');
    const before = structuredClone(rich);
    const out = renderTemplate(rich, { Name: 'Ada' });
    expect(out).toEqual(normalizeRich(out));
    expect(out).toEqual({ lines: [{ runs: [{ text: 'Ada' }] }] });
    expect(rich).toEqual(before);
  });

  it('uses the first of several keys that match the same field', () => {
    expect(render('{{zip}}', { Zip: '1', ZIP: '2' })).toBe('1');
  });

  it('splits a multi-line value into separate lines', () => {
    expect(render('{{Name}}\n{{Address}}\n{{City}}', { Name: 'Jane', Address: '12 Elm St\nApt 4', City: 'X' }))
      .toBe('Jane\n12 Elm St\nApt 4\nX');
  });

  it('splits on CRLF and CR, and drops empty lines from the value', () => {
    expect(render('{{Address}}', { Address: 'A\r\n\r\nB\rC\n' })).toBe('A\nB\nC');
  });

  it('keeps run styles and the line size on every split line', () => {
    const rich: RichText = {
      lines: [{ runs: [{ text: 'To ' }, { text: '{{Address}}', bold: true }, { text: ' (home)', italic: true }], size: 14 }],
    };
    expect(renderTemplate(rich, { Address: '12 Elm St\nApt 4' })).toEqual({
      lines: [
        { runs: [{ text: 'To ' }, { text: '12 Elm St', bold: true }], size: 14 },
        { runs: [{ text: 'Apt 4', bold: true }, { text: ' (home)', italic: true }], size: 14 },
      ],
    });
  });

  it('maps tabs in values to spaces', () => {
    expect(render('{{Name}}', { Name: 'Ada\tLovelace' })).toBe('Ada Lovelace');
  });

  it('decides blank-line removal before splitting a value', () => {
    expect(render('{{Name}}\n{{Address 2}}\n{{City}}', { Name: 'A', 'Address 2': ' \n \t', City: 'C' })).toBe('A\nC');
  });

  it('renders an empty template as empty rich text', () => {
    expect(renderTemplate({ lines: [] }, RECORD)).toEqual({ lines: [] });
  });
});

describe('renameTokens', () => {
  it('rewrites matching tokens case- and space-insensitively', () => {
    const out = renameTokens(plain('{{ zip  code }}\n{{ZIP Code}}'), 'Zip Code', 'Postal Code');
    expect(richToPlain(out)).toBe('{{Postal Code}}\n{{Postal Code}}');
  });

  it('leaves other tokens and text alone', () => {
    const out = renameTokens(plain('Dear {{ Name }}, {{City}} {{Zip}}'), 'zip', 'Postcode');
    expect(richToPlain(out)).toBe('Dear {{ Name }}, {{City}} {{Postcode}}');
  });

  it('preserves runs, styles, sizes, and empty lines', () => {
    const rich: RichText = {
      lines: [
        { runs: [{ text: ' To: ', italic: true }, { text: '{{Name}}', bold: true }], size: 14 },
        { runs: [] },
      ],
    };
    expect(renameTokens(rich, 'name', 'Full Name')).toEqual({
      lines: [
        { runs: [{ text: ' To: ', italic: true }, { text: '{{Full Name}}', bold: true }], size: 14 },
        { runs: [] },
      ],
    });
  });

  it('returns an unchanged copy when the new name is blank or has braces', () => {
    const rich = plain('{{Name}}');
    expect(renameTokens(rich, 'Name', '  ')).toEqual(rich);
    expect(renameTokens(rich, 'Name', 'A}}B')).toEqual(rich);
    expect(renameTokens(rich, 'Name', '  ')).not.toBe(rich);
  });

  it('does not change the input', () => {
    const rich = plain('{{Name}}');
    renameTokens(rich, 'Name', 'Full Name');
    expect(richToPlain(rich)).toBe('{{Name}}');
  });
});

describe('unknownTokens', () => {
  it('lists tokens with no matching column', () => {
    const rich = plain('{{Name}}\n{{ zip code }} {{Nickname}} {{nickname}}');
    expect(unknownTokens(rich, ['NAME', 'Zip  Code'])).toEqual(['Nickname']);
  });

  it('returns nothing when every token matches', () => {
    expect(unknownTokens(plain(ADDRESS), Object.keys(RECORD))).toEqual([]);
  });
});

describe('recordFromRow', () => {
  it('maps column names to the row values, using empty strings for missing cells', () => {
    const dataset = { columns: [{ name: 'Name' }, { name: 'City' }, { name: 'Zip' }], rows: [['Ada', 'London']] };
    expect(recordFromRow(dataset, 0)).toEqual({ Name: 'Ada', City: 'London', Zip: '' });
  });

  it('handles column names that collide with object properties', () => {
    const dataset = { columns: [{ name: 'constructor' }, { name: '__proto__' }, { name: 'Name' }], rows: [['a', 'b', 'c']] };
    const record = recordFromRow(dataset, 0);
    expect(Object.keys(record)).toEqual(['constructor', '__proto__', 'Name']);
    expect(record.constructor).toBe('a');
    expect(richToPlain(renderTemplate(plain('{{Constructor}} {{__proto__}} {{toString}}'), record))).toBe('a b');
  });

  it('keeps the first of two columns with the same name', () => {
    expect(recordFromRow({ columns: [{ name: 'A' }, { name: 'A' }], rows: [['1', '2']] }, 0)).toEqual({ A: '1' });
  });

  it('returns an empty-valued record for a row that does not exist', () => {
    expect(recordFromRow({ columns: [{ name: 'Name' }], rows: [] }, 3)).toEqual({ Name: '' });
  });
});

describe('editor round trip', () => {
  it('keeps tokens as plain text through richToHtml and htmlToRich', () => {
    const rich: RichText = {
      lines: [
        { runs: [{ text: '{{First Name}} ', bold: true }, { text: '{{Last Name}}' }], size: 16 },
        { runs: [{ text: '{{City}}, {{State}}  {{Zip}}', italic: true }] },
      ],
    };
    const back = normalizeRich(htmlToRich(richToHtml(rich)));
    expect(back).toEqual(rich);
    expect(findTokens(back)).toEqual(['First Name', 'Last Name', 'City', 'State', 'Zip']);
    expect(richToPlain(renderTemplate(back, { 'first name': 'Ada', 'last name': 'L', city: 'X', state: 'Y', zip: 'Z' })))
      .toBe('Ada L\nX, Y  Z');
  });
});
