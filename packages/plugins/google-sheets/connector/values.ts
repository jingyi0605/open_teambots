import { compact } from '../../_shared/reference';
import { formatCells, parseCells, splitRange, type Cells } from './a1';

export type Cell = string | number | boolean | null;
export const maxWriteCells = 10_000;

export function checkCellCount(values: Cell[][]) {
  const count = values.reduce((n, row) => n + row.length, 0);
  if (count > maxWriteCells) throw new Error(`values holds ${count} cells; write at most ${maxWriteCells} cells per call and send the remaining rows in further calls`);
}

const csvCell = (v: unknown) => {
  const s = v === true ? 'TRUE' : v === false ? 'FALSE' : v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};
export const csvRow = (row: unknown[] = []) => row.map(csvCell).join(',');

export type Section = { sheet?: string; range: string; csv: string; truncated?: true; nextCells?: string; note?: string };
/** Render batchGet value ranges as CSV sections sharing one character budget, cut on whole rows. */
export function renderSections(valueRanges: Array<{ range: string; values?: unknown[][] }>, maxChars: number): { truncated: boolean; sections: Section[] } {
  let used = 0, stopped = false;
  const sections = valueRanges.map((vr): Section => {
    const { sheet, cells } = splitRange(vr.range);
    const rows = vr.values ?? [], lines: string[] = [];
    let cut: number | undefined;
    for (const [i, row] of rows.entries()) {
      const line = csvRow(row), cost = line.length + (lines.length ? 1 : 0);
      if (stopped || used + cost > maxChars) { cut = i; stopped = true; break; }
      lines.push(line); used += cost;
    }
    if (cut === undefined) return compact({ sheet, range: cells, csv: lines.join('\n') });
    const oversized = csvRow(rows[cut]).length > maxChars;
    const bounds: Cells = cells ? parseCells(cells) : {};
    const nextCells = oversized ? undefined : formatCells({ ...bounds, startRow: (bounds.startRow ?? 0) + cut });
    const note = oversized ? `Row ${(bounds.startRow ?? 0) + cut + 1} alone is longer than maxChars (${maxChars}); raise maxChars or narrow cells to fewer columns.` : undefined;
    return compact({ sheet, range: cells, csv: lines.join('\n'), truncated: true as const, nextCells, note });
  });
  return { truncated: stopped, sections };
}

export type Block = { row: number; col: number; values: Cell[][] };
/**
 * Split a value grid into rectangular blocks that skip null cells, so null leaves the existing
 * cell untouched. Rows continue a block when their run starts in the same column; shorter rows
 * write only their own cells.
 */
export function writeBlocks(values: Cell[][]): Block[] {
  const blocks: Block[] = [];
  let previous = new Map<number, Block>();
  for (const [r, row] of values.entries()) {
    const current = new Map<number, Block>();
    let run: { start: number; cells: Cell[] } | undefined;
    const close = () => {
      if (!run) return;
      // `previous` only holds blocks that reached row r - 1, so extending one stays contiguous.
      let block = previous.get(run.start);
      if (block) block.values.push(run.cells);
      else blocks.push(block = { row: r, col: run.start, values: [run.cells] });
      current.set(run.start, block);
      run = undefined;
    };
    for (const [c, value] of row.entries()) {
      if (value === null) { close(); continue; }
      if (!run) run = { start: c, cells: [] };
      run.cells.push(value);
    }
    close();
    previous = current;
  }
  return blocks;
}

export const blockCells = (b: Block, top: number, left: number): Cells => ({
  startRow: top + b.row, endRow: top + b.row + b.values.length,
  startCol: left + b.col, endCol: left + b.col + Math.max(...b.values.map(v => v.length)),
});
