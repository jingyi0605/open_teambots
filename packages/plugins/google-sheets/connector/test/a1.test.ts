import { expect, test } from 'bun:test';
import { a1Range, columnIndex, columnLetters, formatCells, gridRange, normalizeCells, parseCells, splitRange } from '../a1';
import { cellFormat, chartSpec, color, condition, numberFormatType } from '../format';
import { csvRow, renderSections, writeBlocks } from '../values';

test('A1 cells parse to zero-based, end-exclusive bounds and normalize', () => {
  expect(parseCells('B2')).toEqual({ startRow: 1, endRow: 2, startCol: 1, endCol: 2 });
  expect(parseCells(' $a$1:$d$10 ')).toEqual({ startRow: 0, endRow: 10, startCol: 0, endCol: 4 });
  expect(parseCells('A:C')).toEqual({ startCol: 0, endCol: 3 });
  expect(parseCells('2:5')).toEqual({ startRow: 1, endRow: 5 });
  expect(parseCells('A5:A')).toEqual({ startRow: 4, startCol: 0, endCol: 1 });
  const cases: Record<string, string> = { 'b2': 'B2', 'A1:A1': 'A1', 'D10:A1': 'A1:D10', 'C:A': 'A:C', '5:1': '1:5', 'A5:A': 'A5:A', 'B2:D': 'B2:D', 'A1:C': 'A:C', 'ZZZ1': 'ZZZ1' };
  for (const [input, output] of Object.entries(cases)) expect(normalizeCells(input)).toBe(output);
  for (const bad of ['', 'A', '5', 'A:5', 'A:C10', 'A1:B2:C3', 'AAAA1', 'A0', 'A1-B2']) expect(() => parseCells(bad)).toThrow('Invalid cells');
  expect(() => parseCells('Sheet1!A1:B2')).toThrow('includes a tab');
});

test('Column letters round-trip through the full Sheets column range', () => {
  expect([0, 25, 26, 51, 701, 702, 18277].map(columnLetters)).toEqual(['A', 'Z', 'AA', 'AZ', 'ZZ', 'AAA', 'ZZZ']);
  expect(['A', 'z', 'AA', 'AZ', 'ZZ', 'AAA', 'ZZZ'].map(columnIndex)).toEqual([0, 25, 26, 51, 701, 702, 18277]);
});

test('Tab titles are quoted with doubled apostrophes and API ranges split back to title and cells', () => {
  expect(a1Range("Bob's Q1 data", 'b2:c3')).toBe("'Bob''s Q1 data'!B2:C3");
  expect(a1Range('Data')).toBe("'Data'");
  expect(a1Range(undefined, 'a1:b2')).toBe('A1:B2');
  expect(splitRange("'Q1 ''24!'!A1:B2")).toEqual({ sheet: "Q1 '24!", cells: 'A1:B2' });
  expect(splitRange('Data!A1:Z1000')).toEqual({ sheet: 'Data', cells: 'A1:Z1000' });
});

test('Grid ranges leave unbounded edges out', () => {
  expect(gridRange(7, 'B2:D4')).toEqual({ sheetId: 7, startRowIndex: 1, endRowIndex: 4, startColumnIndex: 1, endColumnIndex: 4 });
  expect(gridRange(0, 'A:C')).toEqual({ sheetId: 0, startColumnIndex: 0, endColumnIndex: 3 });
  expect(gridRange(0, '2:5')).toEqual({ sheetId: 0, startRowIndex: 1, endRowIndex: 5 });
  expect(gridRange(3)).toEqual({ sheetId: 3 });
});

test('CSV quotes commas, quotes and newlines and renders booleans as Sheets shows them', () => {
  expect(csvRow(['plain', 'a,b', 'say "hi"', 'two\nlines', 12.5, true, false, null])).toBe('plain,"a,b","say ""hi""","two\nlines",12.5,TRUE,FALSE,');
});

test('Read sections share one budget, cut on whole rows and point nextCells at the first unread row', () => {
  const rows = [['h1', 'h2'], ['aaaa', 'bbbb'], ['cccc', 'dddd'], ['eeee', 'ffff']];
  const all = renderSections([{ range: 'Data!A1:B4', values: rows }], 1000);
  expect(all).toEqual({ truncated: false, sections: [{ sheet: 'Data', range: 'A1:B4', csv: 'h1,h2\naaaa,bbbb\ncccc,dddd\neeee,ffff' }] });
  const cut = renderSections([{ range: 'Data!A1:B4', values: rows }, { range: "'Other tab'!C5:C1000", values: [['x']] }], 'h1,h2\naaaa,bbbb'.length + 3);
  expect(cut.truncated).toBe(true);
  expect(cut.sections[0]).toEqual({ sheet: 'Data', range: 'A1:B4', csv: 'h1,h2\naaaa,bbbb', truncated: true, nextCells: 'A3:B4' });
  expect(cut.sections[1]).toEqual({ sheet: 'Other tab', range: 'C5:C1000', csv: '', truncated: true, nextCells: 'C5:C1000' });
  const empty = renderSections([{ range: 'Data!A1:B4', values: rows }, { range: 'Blank!A1:Z1000' }], 'h1,h2\naaaa,bbbb'.length);
  expect(empty.sections[1]).toEqual({ sheet: 'Blank', range: 'A1:Z1000', csv: '' });
});

test('A row longer than maxChars ends the section without nextCells', () => {
  const result = renderSections([{ range: 'Data!A1:B3', values: [['ok'], ['x'.repeat(50)], ['later']] }], 20);
  expect(result.sections[0]!.csv).toBe('ok');
  expect(result.sections[0]!.nextCells).toBeUndefined();
  expect(result.sections[0]!.note).toContain('Row 2 alone is longer than maxChars');
});

test('Write blocks skip null cells and keep contiguous runs together', () => {
  expect(writeBlocks([[1, 2, 3], [4, 5, 6]])).toEqual([{ row: 0, col: 0, values: [[1, 2, 3], [4, 5, 6]] }]);
  expect(writeBlocks([[1, 2, 3], [4, null, ''], [7, 8, 9], [null, null], [1]])).toEqual([
    { row: 0, col: 0, values: [[1, 2, 3], [4], [7, 8, 9]] }, { row: 1, col: 2, values: [['']] }, { row: 4, col: 0, values: [[1]] },
  ]);
  expect(writeBlocks([[null, 'b'], [null, 'd']])).toEqual([{ row: 0, col: 1, values: [['b'], ['d']] }]);
  expect(writeBlocks([[null]])).toEqual([]);
});

test('Colors, number formats and conditions convert to Sheets types', () => {
  expect(color('#FF8000')).toEqual({ red: 1, green: 128 / 255, blue: 0 });
  expect(() => color('red')).toThrow('#RRGGBB');
  const types: Record<string, string> = { '#,##0.00': 'NUMBER', '0.0%': 'PERCENT', '$#,##0': 'CURRENCY', 'yyyy-mm-dd': 'DATE', 'hh:mm:ss': 'TIME', 'yyyy-mm-dd hh:mm': 'DATE_TIME', '[Red]#,##0': 'NUMBER', '0.00E+00': 'SCIENTIFIC', '@': 'TEXT', '[$€-407]#,##0.00': 'CURRENCY', '[h]:mm': 'TIME', 'mmm d': 'DATE', '0 "days"': 'NUMBER' };
  for (const [pattern, type] of Object.entries(types)) expect(numberFormatType(pattern)).toBe(type);
  expect(condition('NUMBER_BETWEEN', ['1', '10'])).toEqual({ type: 'NUMBER_BETWEEN', values: [{ userEnteredValue: '1' }, { userEnteredValue: '10' }] });
  expect(condition('BLANK')).toEqual({ type: 'BLANK' });
  expect(condition('CUSTOM_FORMULA', ['A1>100'])).toEqual({ type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: '=A1>100' }] });
  expect(() => condition('NUMBER_GREATER', [])).toThrow('takes 1 value');
  expect(() => condition('NUMBER_BETWEEN', ['1'])).toThrow('takes 2 values');
  expect(() => condition('NOT_BLANK', ['x'])).toThrow('takes 0 values');
  expect(() => condition('ONE_OF_LIST', [], true)).toThrow('at least one');
  expect(cellFormat({ bold: true, backgroundColor: '#000000', numberFormatPattern: '0%' }).fields).toBe('userEnteredFormat.textFormat.bold,userEnteredFormat.backgroundColorStyle,userEnteredFormat.numberFormat');
  expect(() => cellFormat({})).toThrow('at least one format property');
});

test('Chart specs reject ranges that are neither one column nor one row', () => {
  expect(() => chartSpec({ sheetId: 0, chartType: 'LINE', ranges: [{ cells: 'A1:B7' }, { cells: 'C1:C7' }] })).toThrow('spans several rows and columns');
  const row = chartSpec({ sheetId: 0, chartType: 'PIE', ranges: [{ cells: 'A1:E1' }, { cells: 'A2:E2' }] });
  expect(row.pieChart.domain.sourceRange.sources[0]).toEqual({ sheetId: 0, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 1, endColumnIndex: 5 });
});
