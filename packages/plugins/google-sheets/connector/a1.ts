import { compact } from '../../_shared/reference';

/** Zero-based, end-exclusive cell bounds; an absent bound is unbounded (whole rows/columns). */
export type Cells = { startRow?: number; endRow?: number; startCol?: number; endCol?: number };
export type GridRange = { sheetId: number; startRowIndex?: number; endRowIndex?: number; startColumnIndex?: number; endColumnIndex?: number };

const maxColumns = 18_278, maxRows = 10_000_000;
const endpoint = /^\$?([A-Za-z]{1,3})?\$?(\d+)?$/;

export const columnIndex = (letters: string) => [...letters.toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
export function columnLetters(index: number) {
  let s = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export function parseCells(input: string): Cells {
  const text = input.trim();
  if (text.includes('!')) throw new Error(`cells "${input}" includes a tab; give A1 notation without the tab (the tab is chosen separately)`);
  const invalid = () => new Error(`Invalid cells "${input}": use A1 notation without the tab, e.g. B2, A1:D10, A:C, 2:5 or A5:A`);
  const parts = text.split(':');
  if (!text || parts.length > 2) throw invalid();
  const [p, q] = parts.map(part => {
    const m = endpoint.exec(part.trim());
    if (!m || (!m[1] && !m[2])) throw invalid();
    const col = m[1] ? columnIndex(m[1]) : undefined, row = m[2] ? Number(m[2]) - 1 : undefined;
    if ((row !== undefined && (row < 0 || row >= maxRows)) || (col !== undefined && col >= maxColumns)) throw invalid();
    return { col, row };
  }) as Array<{ col?: number; row?: number }>;
  const cell = (e: { col?: number; row?: number }) => e.col !== undefined && e.row !== undefined;
  if (!q) {
    if (!cell(p!)) throw invalid();
    return { startRow: p!.row, endRow: p!.row! + 1, startCol: p!.col, endCol: p!.col! + 1 };
  }
  const span = (a?: number, b?: number) => [Math.min(a!, b!), Math.max(a!, b!) + 1] as const;
  if (cell(p!) && cell(q)) {
    const [startRow, endRow] = span(p!.row, q.row), [startCol, endCol] = span(p!.col, q.col);
    return { startRow, endRow, startCol, endCol };
  }
  if (p!.row === undefined && q.row === undefined) { const [startCol, endCol] = span(p!.col, q.col); return { startCol, endCol }; }
  if (p!.col === undefined && q.col === undefined) { const [startRow, endRow] = span(p!.row, q.row); return { startRow, endRow }; }
  // Open-ended column range such as A5:A or B2:D (from row 5 to the bottom of the tab).
  if (cell(p!) && q.col !== undefined && q.row === undefined) { const [startCol, endCol] = span(p!.col, q.col); return { startRow: p!.row, startCol, endCol }; }
  throw invalid();
}

export function formatCells(c: Cells): string {
  const col = (i?: number) => (i === undefined ? '' : columnLetters(i));
  const bounded = c.startRow !== undefined && c.endRow !== undefined && c.startCol !== undefined && c.endCol !== undefined;
  if (bounded && c.endRow! - c.startRow! === 1 && c.endCol! - c.startCol! === 1) return `${col(c.startCol)}${c.startRow! + 1}`;
  if (bounded) return `${col(c.startCol)}${c.startRow! + 1}:${col(c.endCol! - 1)}${c.endRow}`;
  if (c.startCol === undefined) return c.startRow === undefined ? '' : `${c.startRow + 1}:${c.endRow ?? maxRows}`;
  const left = `${col(c.startCol)}${c.startRow === undefined || c.startRow === 0 && c.endRow === undefined ? '' : c.startRow + 1}`;
  const right = c.endCol === undefined ? columnLetters(maxColumns - 1) : col(c.endCol - 1);
  return `${left}:${right}`;
}

export const normalizeCells = (cells: string) => formatCells(parseCells(cells));
export const quoteSheet = (title: string) => `'${title.replaceAll("'", "''")}'`;
/** An API range string: the quoted tab title (when given) and the normalized A1 cells. */
export const a1Range = (sheet?: string, cells?: string) => {
  const a1 = cells === undefined ? '' : normalizeCells(cells);
  if (sheet === undefined) return a1;
  return a1 ? `${quoteSheet(sheet)}!${a1}` : quoteSheet(sheet);
};

/** Split an API range such as `'Q1 ''24'!A1:B2` or `Data!A1:B2` into its tab title and cells. */
export function splitRange(range: string): { sheet?: string; cells: string } {
  if (range.startsWith("'")) {
    let title = '', i = 1;
    for (; i < range.length; i++) {
      if (range[i] !== "'") { title += range[i]; continue; }
      if (range[i + 1] !== "'") break;
      title += "'"; i++;
    }
    return { sheet: title, cells: range.slice(i + 2) };
  }
  const at = range.lastIndexOf('!');
  return at < 0 ? { sheet: range, cells: '' } : { sheet: range.slice(0, at), cells: range.slice(at + 1) };
}

export const gridRange = (sheetId: number, cells?: string | Cells): GridRange => {
  const c = typeof cells === 'string' ? parseCells(cells) : cells ?? {};
  return compact({ sheetId, startRowIndex: c.startRow, endRowIndex: c.endRow, startColumnIndex: c.startCol, endColumnIndex: c.endCol });
};
