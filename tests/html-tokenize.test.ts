import { describe, it, expect } from 'vitest';
import { tokenize, decodeEntities, NAMED_ENTITIES } from '../src/lib/html-tokenize';
import { htmlToRich, richToPlain } from '../src/lib/richtext';

describe('decodeEntities', () => {
  it('decodes named, decimal, and hex entities and leaves unknown names alone', () => {
    expect(decodeEntities('&amp;&lt;&gt;&quot;&apos;&#65;&#x42;&#X43;&bogus;')).toBe('&<>"\'ABC&bogus;');
  });

  it('decodes &nbsp; to a no-break space', () => {
    expect(decodeEntities('a&nbsp;b')).toBe('a\u00a0b');
    expect(NAMED_ENTITIES.nbsp).toBe('\u00a0');
  });

  it('replaces &#0; with U+FFFD', () => {
    expect(decodeEntities('a&#0;b')).toBe('a\ufffdb');
  });

  it('replaces a lone surrogate (&#xD800;) with U+FFFD', () => {
    expect(decodeEntities('&#xD800;')).toBe('\ufffd');
  });

  it('replaces a code point beyond U+10FFFF (&#99999999;) with U+FFFD', () => {
    expect(decodeEntities('&#99999999;')).toBe('\ufffd');
  });

  it('decodes an astral code point', () => {
    expect(decodeEntities('&#x1F600;')).toBe('\u{1F600}');
  });
});

describe('tokenize', () => {
  it('emits text, start tags with attributes, and end tags', () => {
    expect(tokenize('<p class="x">a &amp; b</p>')).toEqual([
      { type: 'start', name: 'p', attrs: { class: 'x' }, selfClosing: false },
      { type: 'text', text: 'a & b' },
      { type: 'end', name: 'p' },
    ]);
  });

  it('drops an unterminated comment at EOF', () => {
    expect(tokenize('a<!-- never closed <b>x</b>')).toEqual([{ type: 'text', text: 'a' }]);
  });

  it('ends an unterminated tag at EOF', () => {
    expect(tokenize('a<b class=x')).toEqual([
      { type: 'text', text: 'a' },
      { type: 'start', name: 'b', attrs: { class: 'x' }, selfClosing: false },
    ]);
  });

  it('ends an unterminated quoted attribute at EOF', () => {
    expect(tokenize('<span title="abc>def')).toEqual([
      { type: 'start', name: 'span', attrs: { title: 'abc>def' }, selfClosing: false },
    ]);
  });

  it('marks <br/> self-closing and reads </br> as an end tag named br', () => {
    expect(tokenize('<br/><br /></br>')).toEqual([
      { type: 'start', name: 'br', attrs: {}, selfClosing: true },
      { type: 'start', name: 'br', attrs: {}, selfClosing: true },
      { type: 'end', name: 'br' },
    ]);
  });

  it('lowercases tag and attribute names, including mixed-case close tags', () => {
    expect(tokenize('<DiV Data-Size="9">x</dIv>')).toEqual([
      { type: 'start', name: 'div', attrs: { 'data-size': '9' }, selfClosing: false },
      { type: 'text', text: 'x' },
      { type: 'end', name: 'div' },
    ]);
  });

  it('skips raw-text content up to a mixed-case close tag', () => {
    expect(tokenize('<SCRIPT>if (a < b) "<b>x</b>"</Script>y')).toEqual([
      { type: 'start', name: 'script', attrs: {}, selfClosing: false },
      { type: 'end', name: 'script' },
      { type: 'text', text: 'y' },
    ]);
  });

  it('skips raw-text content to EOF when the close tag is missing', () => {
    expect(tokenize('<style>p{}<b>x</b>')).toEqual([
      { type: 'start', name: 'style', attrs: {}, selfClosing: false },
      { type: 'end', name: 'style' },
    ]);
  });

  it('keeps tags after raw text preceded by characters whose lowercase changes length', () => {
    const tokens = tokenize('İİİİİİİİİ<style>a</style><b>x</b>');
    expect(tokens).toEqual([
      { type: 'text', text: 'İİİİİİİİİ' },
      { type: 'start', name: 'style', attrs: {}, selfClosing: false },
      { type: 'end', name: 'style' },
      { type: 'start', name: 'b', attrs: {}, selfClosing: false },
      { type: 'text', text: 'x' },
      { type: 'end', name: 'b' },
    ]);
  });

  it('tokenizes a 100 KB paste of repeated <style> elements quickly', () => {
    const html = '<style>x</style>'.repeat(Math.ceil(100_000 / 16));
    const start = performance.now();
    const tokens = tokenize(html);
    expect(performance.now() - start).toBeLessThan(500);
    expect(tokens).toHaveLength(Math.ceil(100_000 / 16) * 2);
  });
});

describe('hidden elements', () => {
  it('hides head, template, and svg content', () => {
    expect(
      richToPlain(
        htmlToRich(
          '<head><title>T</title><meta name=x>head text</head><template><b>t</b></template>a<svg><text>s</text></svg>b',
        ),
      ),
    ).toBe('ab');
  });

  it('emits start and end tokens for hidden elements so the parser can track them', () => {
    expect(tokenize('<template>t</template>').map((t) => t.type)).toEqual(['start', 'text', 'end']);
  });
});
