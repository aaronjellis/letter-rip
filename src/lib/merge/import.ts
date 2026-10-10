/**
 * Mail merge data import: CSV, TSV, pasted cells, and Excel workbooks.
 *
 * Everything here is pure except `parseWorkbook`, which loads SheetJS on demand so the main
 * bundle doesn't carry it. Dataset edits return a new `Dataset` and never mutate their input,
 * so a Svelte `$state` holder can simply be reassigned.
 *
 * Typical flow:
 *   cells = parseDelimited(text)            // or (await parseWorkbook(bytes)).sheets[i].cells
 *   ds = buildDataset(cells, { sourceName, headerRow: detectHeaderRow(cells), transposed: false })
 *   ds = renameColumn(ds, 'c1', 'Town')     // setIncluded, setHeaderRow, setTransposed, ...
 *   record = recordFromRow(ds, r)           // { Name: 'Ada', Town: 'London' }
 */

export type Column = {
  /** Stable positional id, `c0`, `c1`, ... */
  id: string;
  /** The user's name for the column; unique ignoring case. */
  name: string;
  /** The name assigned on load. Equal to `name` until the user renames the column. */
  originalName: string;
};

export type Dataset = {
  sourceName: string;
  /** For workbooks: all usable sheet names. */
  sheetNames?: string[];
  activeSheet?: string;
  headerRow: boolean;
  transposed: boolean;
  columns: Column[];
  /** rows[r][c]: trimmed strings, header row excluded, every row `columns.length` wide. */
  rows: string[][];
  included: boolean[];
  /**
   * The cells exactly as loaded (before transposing, trimming, or dropping rows).
   * `setHeaderRow` and `setTransposed` rebuild from this; treat it as read-only.
   */
  source: readonly (readonly string[])[];
};

export type BuildOptions = {
  sourceName: string;
  headerRow: boolean;
  transposed: boolean;
  sheetNames?: string[];
  activeSheet?: string;
};

export type Delimiter = '\t' | ',' | ';' | (string & {});

export const UNREADABLE_FILE = "Couldn't read that file. Use CSV, TSV, or Excel.";
export const NO_ROWS = 'That workbook has no rows.';

/** An import failure whose `message` is ready to show the user. */
export class ImportError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ImportError';
  }
}

// ---------------------------------------------------------------------------
// Delimited text

const CANDIDATES = ['\t', ',', ';'] as const;
const SAMPLE_LINES = 20;

/** Count `ch` in `line`, ignoring characters inside double quotes. */
function countOutsideQuotes(line: string, ch: string): number {
  let n = 0;
  let quoted = false;
  for (const c of line) {
    if (c === '"') quoted = !quoted;
    else if (c === ch && !quoted) n++;
  }
  return n;
}

/**
 * Pick tab, comma, or semicolon by counting each on the first non-empty lines (outside quotes).
 * A delimiter that appears the same number of times on every sampled line wins; ties and
 * inconsistent counts go to the highest total, then to tab, comma, semicolon in that order.
 * Text with none of them is one column (returns tab, which then never splits).
 */
export function detectDelimiter(text: string): Delimiter {
  const lines = stripBom(text)
    .split(/\r\n|\n|\r/)
    .filter((l) => l.trim() !== '')
    .slice(0, SAMPLE_LINES);
  let best: { d: Delimiter; consistent: boolean; total: number } | null = null;
  for (const d of CANDIDATES) {
    const counts = lines.map((l) => countOutsideQuotes(l, d));
    const total = counts.reduce((a, b) => a + b, 0);
    if (total === 0) continue;
    const consistent = counts.every((c) => c === counts[0]);
    if (
      !best ||
      (consistent && !best.consistent) ||
      (consistent === best.consistent && total > best.total)
    ) {
      best = { d, consistent, total };
    }
  }
  return best?.d ?? '\t';
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Parse delimited text per RFC 4180: double-quoted fields may contain the delimiter, `""`, and
 * line breaks; rows end at CRLF, LF, or CR. A leading BOM is stripped and a final line break
 * doesn't add a row. Fields are returned as written (not trimmed); `buildDataset` trims.
 * Without `delimiter`, see `detectDelimiter`.
 */
export function parseDelimited(text: string, opts: { delimiter?: Delimiter } = {}): string[][] {
  const src = stripBom(text);
  const delim = opts.delimiter ?? detectDelimiter(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let fieldStart = true;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = '';
    fieldStart = true;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < src.length) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else {
        field += c;
      }
      i++;
      continue;
    }
    if (c === '"' && fieldStart) {
      quoted = true;
      fieldStart = false;
      i++;
    } else if (src.startsWith(delim, i)) {
      endField();
      i += delim.length;
    } else if (c === '\r' || c === '\n') {
      endRow();
      i += c === '\r' && src[i + 1] === '\n' ? 2 : 1;
    } else {
      // Stray quotes mid-field are kept literally, as Excel does.
      field += c;
      fieldStart = false;
      i++;
    }
  }
  // Flush the last row unless the text ended with a line break (or was empty).
  if (!fieldStart || field !== '' || row.length > 0) endRow();
  return rows;
}

// ---------------------------------------------------------------------------
// Workbooks

/**
 * Read an Excel (or any SheetJS-supported) workbook. Cells come back as their displayed,
 * formatted strings (`raw: false`), so ZIP codes keep leading zeros and dates keep their format.
 * Sheets with no non-empty cell are left out.
 * @throws ImportError with `UNREADABLE_FILE` or `NO_ROWS`.
 */
export async function parseWorkbook(
  bytes: ArrayBuffer | Uint8Array,
): Promise<{ sheets: { name: string; cells: string[][] }[] }> {
  const XLSX = await import('xlsx');
  let wb: import('xlsx').WorkBook;
  try {
    wb = XLSX.read(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), { type: 'array' });
  } catch (err) {
    throw new ImportError(UNREADABLE_FILE, { cause: err });
  }
  const sheets: { name: string; cells: string[][] }[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const cells = XLSX.utils
      .sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: '', blankrows: true })
      .map((r) => r.map((v) => (v == null ? '' : String(v))));
    if (cells.some((r) => !isEmptyRow(r))) sheets.push({ name, cells });
  }
  if (sheets.length === 0) throw new ImportError(NO_ROWS);
  return { sheets };
}

// ---------------------------------------------------------------------------
// Shaping

function isEmptyRow(row: readonly string[]): boolean {
  return row.every((c) => c.trim() === '');
}

/** Largest `f(item)`, or 0. Avoids spreading large row arrays into Math.max. */
function maxOf<T>(items: readonly T[], f: (item: T) => number): number {
  let m = 0;
  for (const item of items) m = Math.max(m, f(item));
  return m;
}

/** Length of `row` up to and including its last non-empty cell. */
function usedWidth(row: readonly string[]): number {
  let w = row.length;
  while (w > 0 && row[w - 1] === '') w--;
  return w;
}

/** Swap rows and columns, padding ragged rows with ''. */
export function transpose(cells: readonly (readonly string[])[]): string[][] {
  const width = maxOf(cells, (r) => r.length);
  return Array.from({ length: width }, (_, c) => cells.map((r) => r[c] ?? ''));
}

const NUMERIC_RE = /^[-+(]?[$€£¥]?\s*\d[\d,.\s/:-]*%?\)?$/;

/**
 * Whether the first non-empty row looks like column labels: no empty cells (across the full
 * table width), no duplicates ignoring case, more than half the cells non-numeric, and at least
 * one non-empty row after it. Numbers, money, percentages, and dates count as numeric.
 */
export function detectHeaderRow(cells: readonly (readonly string[])[]): boolean {
  const rows = cells.filter((r) => !isEmptyRow(r));
  if (rows.length < 2) return false;
  const width = maxOf(rows, (r) => r.length);
  const first = Array.from({ length: width }, (_, c) => (rows[0][c] ?? '').trim());
  if (first.some((c) => c === '')) return false;
  if (new Set(first.map((c) => c.toLowerCase())).size !== first.length) return false;
  const numeric = first.filter((c) => NUMERIC_RE.test(c)).length;
  return numeric * 2 < first.length;
}

/** `name`, or `name 2`, `name 3`, ... whichever is free in `taken` (lower-cased names). */
function uniqueName(name: string, taken: Set<string>): string {
  let candidate = name;
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${name} ${n}`;
  return candidate;
}

/**
 * Shape raw cells into a dataset: transpose first (if asked), trim every cell, drop empty rows,
 * drop trailing columns that are empty everywhere, and pad ragged rows. Column names come from
 * the header row or are `Column N` (1-based); empty headers become `Column N` and duplicates
 * (ignoring case) get ` 2`, ` 3`, ... Every row starts included.
 */
export function buildDataset(cells: readonly (readonly string[])[], opts: BuildOptions): Dataset {
  const shaped = (opts.transposed ? transpose(cells) : cells)
    .map((r) => r.map((c) => (c ?? '').trim()))
    .filter((r) => !isEmptyRow(r));
  const width = maxOf(shaped, usedWidth);
  const padded = shaped.map((r) => Array.from({ length: width }, (_, c) => r[c] ?? ''));

  const header = opts.headerRow && padded.length > 0 ? padded[0] : null;
  const rows = header ? padded.slice(1) : padded;
  const taken = new Set<string>();
  const columns: Column[] = Array.from({ length: width }, (_, c) => {
    const name = uniqueName(header?.[c] || `Column ${c + 1}`, taken);
    taken.add(name.toLowerCase());
    return { id: `c${c}`, name, originalName: name };
  });

  const ds: Dataset = {
    sourceName: opts.sourceName,
    headerRow: opts.headerRow,
    transposed: opts.transposed,
    columns,
    rows,
    included: rows.map(() => true),
    source: cells,
  };
  if (opts.sheetNames) ds.sheetNames = opts.sheetNames;
  if (opts.activeSheet !== undefined) ds.activeSheet = opts.activeSheet;
  return ds;
}

function rebuild(ds: Dataset, change: Partial<Pick<BuildOptions, 'headerRow' | 'transposed'>>): Dataset {
  return buildDataset(ds.source, {
    sourceName: ds.sourceName,
    headerRow: change.headerRow ?? ds.headerRow,
    transposed: change.transposed ?? ds.transposed,
    sheetNames: ds.sheetNames,
    activeSheet: ds.activeSheet,
  });
}

// ---------------------------------------------------------------------------
// Edits (all return a new Dataset)

/**
 * Rename a column. The name is trimmed; an empty name restores `originalName`; a name another
 * column already uses (ignoring case) gets a ` 2`, ` 3`, ... suffix. Read the resulting name
 * back from the returned dataset (for example, to rewrite template tokens).
 */
export function renameColumn(ds: Dataset, id: string, name: string): Dataset {
  const col = ds.columns.find((c) => c.id === id);
  if (!col) return ds;
  const taken = new Set(ds.columns.filter((c) => c.id !== id).map((c) => c.name.toLowerCase()));
  const next = uniqueName(name.trim() || col.originalName, taken);
  return { ...ds, columns: ds.columns.map((c) => (c.id === id ? { ...c, name: next } : c)) };
}

/** Include or exclude one row. Out-of-range indexes return the dataset unchanged. */
export function setIncluded(ds: Dataset, index: number, on: boolean): Dataset {
  if (index < 0 || index >= ds.included.length) return ds;
  const included = ds.included.slice();
  included[index] = on;
  return { ...ds, included };
}

/** Include or exclude every row (Select all / Clear). */
export function setAllIncluded(ds: Dataset, on: boolean): Dataset {
  return { ...ds, included: ds.included.map(() => on) };
}

/** Number of included rows. */
export function includedCount(ds: Dataset): number {
  return ds.included.filter(Boolean).length;
}

/**
 * Toggle whether the first row holds column names. Rebuilds from `ds.source`, so column
 * renames and row inclusion reset.
 */
export function setHeaderRow(ds: Dataset, on: boolean): Dataset {
  return rebuild(ds, { headerRow: on });
}

/**
 * Toggle whether headers run down the first column. Rebuilds from `ds.source` and keeps the
 * current `headerRow` setting; column renames and row inclusion reset.
 */
export function setTransposed(ds: Dataset, on: boolean): Dataset {
  return rebuild(ds, { transposed: on });
}

/** Row `r` as `{ [column name]: value }`, keyed by current column names. Missing rows give ''. */
export function recordFromRow(ds: Dataset, r: number): Record<string, string> {
  const row = ds.rows[r] ?? [];
  const record: Record<string, string> = {};
  ds.columns.forEach((col, c) => {
    record[col.name] = row[c] ?? '';
  });
  return record;
}
