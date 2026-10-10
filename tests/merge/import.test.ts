import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  parseDelimited, detectDelimiter, parseWorkbook, detectHeaderRow, transpose, buildDataset,
  renameColumn, setIncluded, setAllIncluded, setHeaderRow, setTransposed, recordFromRow,
  includedCount, ImportError, UNREADABLE_FILE, NO_ROWS,
} from '../../src/lib/merge/import';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../fixtures/merge/${name}`, import.meta.url))));

describe('parseDelimited', () => {
  it('parses a CSV with quoted commas, quotes, and embedded newlines', () => {
    const csv = 'Name,Address\n"Smith, Jane","12 Elm St\nApt 4"\n"Bob ""The Builder""",Main St\n';
    expect(parseDelimited(csv)).toEqual([
      ['Name', 'Address'],
      ['Smith, Jane', '12 Elm St\nApt 4'],
      ['Bob "The Builder"', 'Main St'],
    ]);
  });

  it('parses TSV', () => {
    expect(parseDelimited('Name\tCity\nAda\tLondon, UK\n')).toEqual([
      ['Name', 'City'],
      ['Ada', 'London, UK'],
    ]);
  });

  it('parses semicolon CSV, as exported by European Excel', () => {
    expect(parseDelimited('Name;City;Amount\nAda;London;1,5\nAlan;Wilmslow;2,25')).toEqual([
      ['Name', 'City', 'Amount'],
      ['Ada', 'London', '1,5'],
      ['Alan', 'Wilmslow', '2,25'],
    ]);
  });

  it('handles CRLF, including inside quoted fields', () => {
    expect(parseDelimited('a,b\r\n"x\r\ny",z\r\n')).toEqual([
      ['a', 'b'],
      ['x\r\ny', 'z'],
    ]);
  });

  it('handles lone CR line endings', () => {
    expect(parseDelimited('a,b\rc,d')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('strips a UTF-8 BOM', () => {
    const rows = parseDelimited('﻿Name,City\nAda,London');
    expect(rows[0][0]).toBe('Name');
  });

  it('treats a paste with no tabs or commas as a single column', () => {
    expect(parseDelimited('Ada Lovelace\nAlan Turing\n')).toEqual([['Ada Lovelace'], ['Alan Turing']]);
  });

  it('keeps empty fields and trailing delimiters', () => {
    expect(parseDelimited('a,,c\n,,\n')).toEqual([['a', '', 'c'], ['', '', '']]);
  });

  it('honors an explicit delimiter', () => {
    expect(parseDelimited('a,b|c', { delimiter: '|' })).toEqual([['a,b', 'c']]);
  });

  it('returns no rows for empty text', () => {
    expect(parseDelimited('')).toEqual([]);
    expect(parseDelimited('﻿')).toEqual([]);
  });
});

describe('detectDelimiter', () => {
  it('prefers tab for spreadsheet pastes that contain commas', () => {
    expect(detectDelimiter('Name\tAddress\nSmith, Jane\t12 Elm St, Apt 4')).toBe('\t');
  });

  it('picks semicolon when commas are only decimal separators', () => {
    expect(detectDelimiter('a;b;c\n1,5;2,5;3\n4;5;6,1')).toBe(';');
  });

  it('ignores delimiters inside quotes', () => {
    expect(detectDelimiter('"a;b;c",d\n"e;f;g",h')).toBe(',');
  });

  it('skips leading blank lines', () => {
    expect(detectDelimiter('\n\n  \na\tb\nc\td')).toBe('\t');
  });
});

describe('detectHeaderRow', () => {
  it('is true for a labeled first row', () => {
    expect(detectHeaderRow([['Name', 'City', 'ZIP'], ['Ada', 'London', '02134']])).toBe(true);
  });

  it('is false when the first row is mostly numeric', () => {
    expect(detectHeaderRow([['1', '2', 'x'], ['3', '4', 'y']])).toBe(false);
    expect(detectHeaderRow([['$1,200.50', '2024-01-15', '15%'], ['a', 'b', 'c']])).toBe(false);
  });

  it('is false when the first row has an empty cell', () => {
    expect(detectHeaderRow([['Name', '', 'ZIP'], ['Ada', 'London', '02134']])).toBe(false);
  });

  it('is false when a ragged first row is shorter than the data', () => {
    expect(detectHeaderRow([['Name', 'City'], ['Ada', 'London', '02134']])).toBe(false);
  });

  it('is false when the first row has duplicates, ignoring case', () => {
    expect(detectHeaderRow([['Name', 'name'], ['Ada', 'Alan']])).toBe(false);
  });

  it('is false without at least one data row', () => {
    expect(detectHeaderRow([['Name', 'City']])).toBe(false);
    expect(detectHeaderRow([['Name', 'City'], ['', '']])).toBe(false);
    expect(detectHeaderRow([])).toBe(false);
  });

  it('skips leading empty rows', () => {
    expect(detectHeaderRow([['', ''], ['Name', 'City'], ['Ada', 'London']])).toBe(true);
  });
});

describe('transpose', () => {
  it('swaps rows and columns, padding ragged rows', () => {
    expect(transpose([['a', 'b', 'c'], ['d']])).toEqual([['a', 'd'], ['b', ''], ['c', '']]);
  });

  it('handles empty input', () => {
    expect(transpose([])).toEqual([]);
  });
});

describe('buildDataset', () => {
  const opts = { sourceName: 'list.csv', headerRow: true, transposed: false };

  it('builds columns from the header row and trims cells', () => {
    const ds = buildDataset([[' Name ', 'City'], ['  Ada ', ' London'], ['Alan', 'Wilmslow']], opts);
    expect(ds.sourceName).toBe('list.csv');
    expect(ds.columns).toEqual([
      { id: 'c0', name: 'Name', originalName: 'Name' },
      { id: 'c1', name: 'City', originalName: 'City' },
    ]);
    expect(ds.rows).toEqual([['Ada', 'London'], ['Alan', 'Wilmslow']]);
    expect(ds.included).toEqual([true, true]);
  });

  it('names columns Column N without a header row', () => {
    const ds = buildDataset([['Ada', 'London'], ['Alan', 'Wilmslow']], { ...opts, headerRow: false });
    expect(ds.columns.map((c) => c.name)).toEqual(['Column 1', 'Column 2']);
    expect(ds.rows).toHaveLength(2);
  });

  it('drops empty rows, including whitespace-only rows', () => {
    const ds = buildDataset([['', ''], ['Name', 'City'], ['Ada', 'London'], ['', '  '], [], ['Alan', '']], opts);
    expect(ds.columns.map((c) => c.name)).toEqual(['Name', 'City']);
    expect(ds.rows).toEqual([['Ada', 'London'], ['Alan', '']]);
    expect(ds.included).toEqual([true, true]);
  });

  it('pads ragged rows to the widest row', () => {
    const ds = buildDataset([['Name', 'City', 'ZIP'], ['Ada'], ['Alan', 'Wilmslow', 'SK9', 'extra']], opts);
    expect(ds.columns.map((c) => c.name)).toEqual(['Name', 'City', 'ZIP', 'Column 4']);
    expect(ds.rows).toEqual([['Ada', '', '', ''], ['Alan', 'Wilmslow', 'SK9', 'extra']]);
  });

  it('drops trailing columns that are empty in every row', () => {
    const ds = buildDataset([['Name', 'City', '', ''], ['Ada', 'London', '', ' ']], opts);
    expect(ds.columns.map((c) => c.name)).toEqual(['Name', 'City']);
    expect(ds.rows).toEqual([['Ada', 'London']]);
  });

  it('names empty headers Column N and dedupes duplicates, ignoring case', () => {
    const ds = buildDataset(
      [['Name', '', 'name', 'Name', 'Column 2', 'City'], ['a', 'b', 'c', 'd', 'e', 'f']],
      opts,
    );
    expect(ds.columns.map((c) => c.name)).toEqual(['Name', 'Column 2', 'name 2', 'Name 3', 'Column 2 2', 'City']);
    expect(ds.columns.map((c) => c.id)).toEqual(['c0', 'c1', 'c2', 'c3', 'c4', 'c5']);
  });

  it('transposes before everything else', () => {
    const ds = buildDataset(
      [['Name', 'Ada', 'Alan'], ['City', 'London', ''], ['', '', '']],
      { ...opts, transposed: true },
    );
    expect(ds.transposed).toBe(true);
    expect(ds.columns.map((c) => c.name)).toEqual(['Name', 'City']);
    expect(ds.rows).toEqual([['Ada', 'London'], ['Alan', '']]);
  });

  it('handles a header-only and an empty source', () => {
    expect(buildDataset([['Name', 'City']], opts).rows).toEqual([]);
    const empty = buildDataset([], opts);
    expect(empty.columns).toEqual([]);
    expect(empty.rows).toEqual([]);
  });

  it('carries sheet info for workbooks', () => {
    const ds = buildDataset([['a']], { ...opts, sheetNames: ['One', 'Two'], activeSheet: 'Two' });
    expect(ds.sheetNames).toEqual(['One', 'Two']);
    expect(ds.activeSheet).toBe('Two');
  });
});

describe('dataset edits', () => {
  const base = () =>
    buildDataset(
      [['Name', 'City'], ['Ada', 'London'], ['Alan', 'Wilmslow'], ['Grace', 'Arlington']],
      { sourceName: 'x.csv', headerRow: true, transposed: false },
    );

  it('renameColumn sets the name and keeps originalName', () => {
    const before = base();
    const ds = renameColumn(before, 'c1', '  Town ');
    expect(ds.columns[1]).toEqual({ id: 'c1', name: 'Town', originalName: 'City' });
    expect(before.columns[1].name).toBe('City');
  });

  it('renameColumn to empty restores the original name', () => {
    const ds = renameColumn(renameColumn(base(), 'c1', 'Town'), 'c1', '   ');
    expect(ds.columns[1].name).toBe('City');
  });

  it('renameColumn dedupes against other columns', () => {
    const ds = renameColumn(base(), 'c1', 'name');
    expect(ds.columns[1].name).toBe('name 2');
    expect(renameColumn(base(), 'c0', 'NAME').columns[0].name).toBe('NAME');
  });

  it('renameColumn ignores unknown ids', () => {
    const ds = base();
    expect(renameColumn(ds, 'c9', 'X')).toBe(ds);
  });

  it('setIncluded and setAllIncluded toggle rows without mutating', () => {
    const before = base();
    const one = setIncluded(before, 1, false);
    expect(one.included).toEqual([true, false, true]);
    expect(before.included).toEqual([true, true, true]);
    expect(includedCount(one)).toBe(2);
    expect(setIncluded(one, 9, false)).toBe(one);
    expect(setAllIncluded(one, false).included).toEqual([false, false, false]);
    expect(setAllIncluded(one, true).included).toEqual([true, true, true]);
  });

  it('setHeaderRow rebuilds from the source cells', () => {
    const off = setHeaderRow(base(), false);
    expect(off.headerRow).toBe(false);
    expect(off.columns.map((c) => c.name)).toEqual(['Column 1', 'Column 2']);
    expect(off.rows[0]).toEqual(['Name', 'City']);
    expect(off.included).toHaveLength(4);
    const on = setHeaderRow(off, true);
    expect(on.columns.map((c) => c.name)).toEqual(['Name', 'City']);
    expect(on.rows).toHaveLength(3);
  });

  it('setTransposed rebuilds from the source cells and back', () => {
    const t = setTransposed(base(), true);
    expect(t.transposed).toBe(true);
    expect(t.columns.map((c) => c.name)).toEqual(['Name', 'Ada', 'Alan', 'Grace']);
    expect(t.rows).toEqual([['City', 'London', 'Wilmslow', 'Arlington']]);
    expect(setTransposed(t, false)).toEqual(base());
  });

  it('recordFromRow keys values by current column names', () => {
    const ds = renameColumn(base(), 'c1', 'Town');
    expect(recordFromRow(ds, 1)).toEqual({ Name: 'Alan', Town: 'Wilmslow' });
    expect(recordFromRow(ds, 99)).toEqual({ Name: '', Town: '' });
  });
});

describe('parseWorkbook', () => {
  it('reads every sheet of an XLSX as formatted strings', async () => {
    const { sheets } = await parseWorkbook(fixture('sample.xlsx'));
    expect(sheets.map((s) => s.name)).toEqual(['Contacts', 'Sideways']);
    const contacts = sheets[0].cells.filter((r) => r.some((c) => c !== ''));
    expect(contacts[0]).toEqual(['Name', 'Street', 'City', 'State', 'ZIP', 'Joined']);
    // ZIP keeps its leading zero and the date keeps its display format.
    expect(contacts[1]).toEqual(['Ada Lovelace', '12 St James Sq', 'London', 'LDN', '02134', '2024-01-15']);
    expect(sheets[1].cells).toEqual([
      ['Name', 'Margaret Hamilton', 'Katherine Johnson'],
      ['City', 'Cambridge', 'Hampton'],
      ['State', 'MA', 'VA'],
    ]);
  });

  it('accepts an ArrayBuffer', async () => {
    const bytes = fixture('sample.xlsx');
    const { sheets } = await parseWorkbook(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    expect(sheets).toHaveLength(2);
  });

  it('feeds buildDataset end to end', async () => {
    const { sheets } = await parseWorkbook(fixture('sample.xlsx'));
    const contacts = sheets[0].cells;
    const ds = buildDataset(contacts, {
      sourceName: 'sample.xlsx',
      headerRow: detectHeaderRow(contacts),
      transposed: false,
      sheetNames: sheets.map((s) => s.name),
      activeSheet: 'Contacts',
    });
    expect(ds.headerRow).toBe(true);
    expect(ds.rows).toHaveLength(3);
    expect(recordFromRow(ds, 2)).toMatchObject({ Name: 'Alan Turing', Street: 'Bletchley Park', ZIP: '90210' });

    const side = sheets[1].cells;
    const t = buildDataset(side, { sourceName: 'sample.xlsx', headerRow: true, transposed: true });
    expect(t.columns.map((c) => c.name)).toEqual(['Name', 'City', 'State']);
    expect(t.rows).toEqual([['Margaret Hamilton', 'Cambridge', 'MA'], ['Katherine Johnson', 'Hampton', 'VA']]);
  });

  it('rejects an unreadable file with a friendly message', async () => {
    const broken = fixture('sample.xlsx').slice(0, 64);
    await expect(parseWorkbook(broken)).rejects.toThrow(ImportError);
    await expect(parseWorkbook(broken)).rejects.toThrow(UNREADABLE_FILE);
  });

  it('rejects a workbook with no rows', async () => {
    await expect(parseWorkbook(new Uint8Array(0))).rejects.toThrow(NO_ROWS);
  });
});
