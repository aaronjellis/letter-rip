/**
 * A small hand-written HTML tokenizer, so HTML mapping runs in Node without a DOM.
 * It is forgiving rather than spec-complete: it reads what clipboards and contenteditable produce.
 */

/** Named entities decoded in text and attribute values; others are left as written. */
export const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  copy: '©',
  reg: '®',
  trade: '™',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  bull: '•',
  middot: '·',
};

const REPLACEMENT_CHARACTER = '\ufffd';

/**
 * Decode named and numeric character references. Code points that are zero, surrogates, or beyond
 * U+10FFFF become U+FFFD; unknown names stay as written.
 */
export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const cp = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      const valid = cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff);
      return valid ? String.fromCodePoint(cp) : REPLACEMENT_CHARACTER;
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}

export type Token =
  | { type: 'text'; text: string }
  | { type: 'start'; name: string; attrs: Record<string, string>; selfClosing: boolean }
  | { type: 'end'; name: string };

/** Elements whose content is raw text up to the matching end tag; their content is discarded. */
export const RAW_TEXT: ReadonlySet<string> = new Set([
  'script', 'style', 'title', 'textarea', 'xmp', 'noscript', 'iframe', 'noembed', 'noframes',
]);

/** Case-insensitive searches for each raw-text element's end tag. Names are fixed, so no escaping is needed. */
const RAW_TEXT_END = new Map([...RAW_TEXT].map((name) => [name, new RegExp(`</${name}`, 'gi')]));

const isTagStart = (c: string | undefined) => c !== undefined && /[A-Za-z]/.test(c);

/** Index just past the end tag of raw-text element `name`, searching from `from`; EOF when missing. */
function skipRawText(html: string, name: string, from: number): number {
  const re = RAW_TEXT_END.get(name)!;
  re.lastIndex = from;
  const match = re.exec(html);
  if (!match) return html.length;
  const gt = html.indexOf('>', match.index);
  return gt === -1 ? html.length : gt + 1;
}

/**
 * Minimal HTML tokenizer: text (entity-decoded), start tags with attributes, end tags.
 * Tag and attribute names are lowercased. Comments, doctypes, processing instructions, and raw-text
 * element content are skipped; a raw-text element yields a start token and a matching end token.
 * Constructs left open at EOF end there.
 */
export function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let text = '';
  const flushText = () => {
    if (text !== '') tokens.push({ type: 'text', text: decodeEntities(text) });
    text = '';
  };

  while (i < html.length) {
    const c = html[i];
    if (c !== '<') {
      text += c;
      i++;
      continue;
    }
    const next = html[i + 1];
    if (html.startsWith('<!--', i)) {
      flushText();
      const close = html.indexOf('-->', i + 4);
      i = close === -1 ? html.length : close + 3;
    } else if (next === '!' || next === '?' || (next === '/' && !isTagStart(html[i + 2]))) {
      // Doctype, CDATA, conditional comment marker, processing instruction, or bogus end tag.
      flushText();
      const close = html.indexOf('>', i + 2);
      i = close === -1 ? html.length : close + 1;
    } else if (next === '/') {
      flushText();
      let j = i + 2;
      while (j < html.length && /[^\s/>]/.test(html[j])) j++;
      const name = html.slice(i + 2, j).toLowerCase();
      const close = html.indexOf('>', j);
      i = close === -1 ? html.length : close + 1;
      tokens.push({ type: 'end', name });
    } else if (isTagStart(next)) {
      flushText();
      let j = i + 1;
      while (j < html.length && /[^\s/>]/.test(html[j])) j++;
      const name = html.slice(i + 1, j).toLowerCase();
      const attrs: Record<string, string> = {};
      let selfClosing = false;
      while (j < html.length) {
        while (j < html.length && /\s/.test(html[j])) j++;
        if (j >= html.length) break;
        if (html[j] === '>') {
          j++;
          break;
        }
        if (html[j] === '/') {
          if (html[j + 1] === '>') {
            selfClosing = true;
            j += 2;
            break;
          }
          j++;
          continue;
        }
        let k = j;
        while (k < html.length && /[^\s/>=]/.test(html[k])) k++;
        const attrName = html.slice(j, k).toLowerCase();
        j = k;
        while (j < html.length && /\s/.test(html[j])) j++;
        let value = '';
        if (html[j] === '=') {
          j++;
          while (j < html.length && /\s/.test(html[j])) j++;
          const q = html[j];
          if (q === '"' || q === "'") {
            const end = html.indexOf(q, j + 1);
            const stop = end === -1 ? html.length : end;
            value = html.slice(j + 1, stop);
            j = stop + 1;
          } else {
            k = j;
            while (k < html.length && /[^\s>]/.test(html[k])) k++;
            value = html.slice(j, k);
            j = k;
          }
        }
        if (attrName !== '' && !(attrName in attrs)) attrs[attrName] = decodeEntities(value);
      }
      i = j;
      tokens.push({ type: 'start', name, attrs, selfClosing });
      if (RAW_TEXT.has(name) && !selfClosing) {
        i = skipRawText(html, name, i);
        tokens.push({ type: 'end', name });
      }
    } else {
      text += c; // A '<' that does not start a tag is text.
      i++;
    }
  }
  flushText();
  return tokens;
}
