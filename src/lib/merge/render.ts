/**
 * Mail merge template rendering: `{{Field}}` tokens in rich text, filled from one record.
 * Pure functions only. Tokens live inside a single run; a token split across runs is plain text.
 */
import { normalizeRich, type RichLine, type RichText, type TextRun } from '../richtext';

/** A merge token such as `{{ First Name }}`; group 1 is the field name with outer spaces removed. */
export const TOKEN_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

/** One merge record: column name to cell value. */
export type MergeRecord = Record<string, string>;

export type RenderOptions = {
  /** Render tokens with no matching field as empty (the default). With false, they stay as written. */
  unknownAsEmpty?: boolean;
};

/** Field-name key for matching: case-insensitive, outer spaces trimmed, inner whitespace collapsed. */
export function fieldKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** The token names in one run of text, trimmed, skipping blank ones like `{{ }}`. */
function tokenNames(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    const name = m[1].trim();
    if (name !== '') out.push(name);
  }
  return out;
}

/**
 * Field names used in the template, in order of first appearance. Each field is listed once, by the
 * spelling it first appears with; `{{Zip Code}}` and `{{zip  code}}` are the same field.
 */
export function findTokens(rich: RichText): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of rich.lines) {
    for (const run of line.runs) {
      for (const name of tokenNames(run.text)) {
        const key = fieldKey(name);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(name);
      }
    }
  }
  return out;
}

/** A lookup from field key to value; when several keys match the same field, the first one wins. */
function recordLookup(record: MergeRecord): Map<string, string> {
  const map = new Map<string, string>();
  for (const [name, value] of Object.entries(record)) {
    const key = fieldKey(name);
    if (!map.has(key)) map.set(key, value);
  }
  return map;
}

/**
 * Fill a template from one record. Tokens match field names case-insensitively and ignore extra
 * spaces. Unmatched tokens render empty unless `unknownAsEmpty` is false. A line that contained a
 * token and renders blank is removed; lines without tokens stay, including empty ones. Run styles
 * and line sizes are kept, and the result is normalized with `normalizeRich`.
 */
export function renderTemplate(rich: RichText, record: MergeRecord, opts: RenderOptions = {}): RichText {
  const unknownAsEmpty = opts.unknownAsEmpty ?? true;
  const values = recordLookup(record);
  const lines: RichLine[] = [];
  for (const line of rich.lines) {
    let hadToken = false;
    const runs: TextRun[] = line.runs.map((run) => {
      const text = run.text.replace(TOKEN_RE, (match: string, name: string) => {
        if (name.trim() === '') return match;
        hadToken = true;
        const value = values.get(fieldKey(name));
        if (value !== undefined) return value;
        return unknownAsEmpty ? '' : match;
      });
      return { ...run, text };
    });
    if (hadToken && runs.every((r) => r.text.trim() === '')) continue;
    lines.push(line.size === undefined ? { runs } : { runs, size: line.size });
  }
  return normalizeRich({ lines });
}

/**
 * Rewrite every `{{from}}` token (matched case-insensitively, ignoring extra spaces) as `{{to}}`.
 * Runs, styles, sizes, and other text are kept as they are. When `to` is blank or contains a brace,
 * the result is an unchanged copy. Returns a new value.
 */
export function renameTokens(rich: RichText, from: string, to: string): RichText {
  const target = fieldKey(from);
  const name = to.trim();
  const valid = name !== '' && !/[{}]/.test(name);
  return {
    lines: rich.lines.map((line) => {
      const runs = line.runs.map((run) => ({
        ...run,
        text: valid
          ? run.text.replace(TOKEN_RE, (match: string, n: string) => (fieldKey(n) === target ? `{{${name}}}` : match))
          : run.text,
      }));
      return line.size === undefined ? { runs } : { runs, size: line.size };
    }),
  };
}

/** Template fields with no matching column name, in order of first appearance. */
export function unknownTokens(rich: RichText, columnNames: string[]): string[] {
  const known = new Set(columnNames.map(fieldKey));
  return findTokens(rich).filter((name) => !known.has(fieldKey(name)));
}

/** The minimal shape of a dataset that `recordFromRow` reads. */
export type RowSource = { columns: { name: string }[]; rows: string[][] };

/**
 * The record for row `r`: each column name mapped to its cell, with '' for missing cells.
 * When two columns share a name, the first one wins.
 */
export function recordFromRow(dataset: RowSource, r: number): MergeRecord {
  const row = dataset.rows[r] ?? [];
  const seen = new Set<string>();
  const entries: [string, string][] = [];
  dataset.columns.forEach((col, c) => {
    if (seen.has(col.name)) return;
    seen.add(col.name);
    entries.push([col.name, row[c] ?? '']);
  });
  // fromEntries defines own properties, so names like `__proto__` or `constructor` are safe.
  return Object.fromEntries(entries);
}
