/**
 * Bridges between the address editor's contenteditable element and RichText.
 * Elements arrive as arguments and are used only through `innerHTML`, so this module loads in Node.
 */
import {
  htmlToRich,
  isRichEmpty,
  mergeRuns,
  normalizeRich,
  plainToRich,
  richToHtml,
  richToInlineHtml,
  type RichLine,
  type RichText,
  type TextRun,
} from './richtext';

/** Anything with an `innerHTML`, such as an HTMLElement. */
export type HtmlHost = { innerHTML: string };

/** Read the editor's content. Not normalized: empty lines and outer spaces are kept while editing. */
export function domToRich(root: HtmlHost): RichText {
  return htmlToRich(root.innerHTML);
}

/** Replace the editor's content with the canonical HTML for `rich`. */
export function richToDom(rich: RichText, root: HtmlHost): void {
  root.innerHTML = richToHtml(rich);
}

/** The whitespace before a line's first visible character, as styled runs. */
function leadingSpace(runs: TextRun[]): TextRun[] {
  const out: TextRun[] = [];
  for (const r of runs) {
    const space = /^\s*/.exec(r.text)![0];
    if (space !== '') out.push({ ...r, text: space });
    if (space.length < r.text.length) break;
  }
  return out;
}

/** The whitespace after a line's last visible character, as styled runs. */
function trailingSpace(runs: TextRun[]): TextRun[] {
  const out: TextRun[] = [];
  for (let i = runs.length - 1; i >= 0; i--) {
    const r = runs[i];
    const space = /\s*$/.exec(r.text)![0];
    if (space !== '') out.unshift({ ...r, text: space });
    if (space.length < r.text.length) break;
  }
  return out;
}

/**
 * Reduce pasted HTML to what an address can hold: text, bold, italic, and line breaks.
 * Returns inline HTML (lines separated by `<br>`, no sizes) ready for insertion at the caret.
 * Leading and trailing blank lines are dropped and whitespace collapses. Lines are trimmed, except
 * that a space at the very start or end of the fragment is kept, since the paste may land mid-line.
 */
export function sanitizePasteHtml(html: string): string {
  const all = htmlToRich(html, { fragment: true }).lines;
  const isBlank = (l: RichLine) => isRichEmpty({ lines: [l] });
  const first = all.findIndex((l) => !isBlank(l));
  if (first === -1) return '';
  let last = all.length - 1;
  while (isBlank(all[last])) last--;
  const raw = all.slice(first, last + 1);
  const lines = normalizeRich({ lines: raw.map((l) => ({ runs: l.runs })) }).lines;
  const lead = leadingSpace(raw[0].runs);
  const trail = trailingSpace(raw[raw.length - 1].runs);
  lines[0] = { runs: mergeRuns(lead, lines[0].runs) };
  lines[lines.length - 1] = { runs: mergeRuns(lines[lines.length - 1].runs, trail) };
  return richToInlineHtml({ lines });
}

/** Pasted plain text as the same inline HTML shape as sanitizePasteHtml. */
export function plainToPasteHtml(text: string): string {
  return richToInlineHtml(normalizeRich(plainToRich(text)));
}
