import type { Args } from '../../_shared/google';
import { compact } from '../../_shared/reference';
import { gridRange, parseCells, type Cells } from './a1';

export function color(hex: string) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new Error(`Colors are "#RRGGBB", got "${hex}"`);
  const n = parseInt(hex.slice(1), 16);
  return { red: ((n >> 16) & 255) / 255, green: ((n >> 8) & 255) / 255, blue: (n & 255) / 255 };
}
export const colorStyle = (hex?: string) => (hex === undefined ? undefined : { rgbColor: color(hex) });

/** Sheets requires a NumberFormat type next to the pattern; infer it from the pattern's tokens. */
export function numberFormatType(pattern: string) {
  const bare = pattern.replace(/"[^"]*"|\\./g, '');
  const currency = /\[\$|[$€£¥₹]/.test(bare);
  const tokens = bare.replace(/\[(?![hms]+\])[^\]]*\]/gi, '');
  if (/^\s*@\s*$/.test(tokens)) return 'TEXT';
  if (tokens.includes('%')) return 'PERCENT';
  if (/[0#?]E[+-]/i.test(tokens)) return 'SCIENTIFIC';
  const date = /[yd]/i.test(tokens) || /mmm/i.test(tokens), time = /[hs]/i.test(tokens) || /am\/pm|a\/p/i.test(tokens);
  if (date) return time ? 'DATE_TIME' : 'DATE';
  if (time) return 'TIME';
  return currency ? 'CURRENCY' : 'NUMBER';
}

const operands: Record<string, number> = { NUMBER_BETWEEN: 2, BLANK: 0, NOT_BLANK: 0 };
/** A BooleanCondition whose operand count matches its type. */
export function condition(type: string, values: string[] = [], list = false): { type: string; values?: Array<{ userEnteredValue: string }> } {
  const expected = list ? undefined : operands[type] ?? 1;
  if (list && !values.length) throw new Error(`${type} needs at least one value in conditionValues`);
  if (expected !== undefined && values.length !== expected) throw new Error(`${type} takes ${expected} value${expected === 1 ? '' : 's'} in conditionValues, got ${values.length}`);
  const operand = (v: string) => ({ userEnteredValue: type === 'CUSTOM_FORMULA' && !v.trimStart().startsWith('=') ? `=${v}` : v });
  return compact({ type, values: values.length ? values.map(operand) : undefined });
}

const extent = (start?: number, end?: number) => (start !== undefined && end !== undefined ? end - start : undefined);
export function chartSpec(a: Args): Record<string, any> {
  const header = a.headerCount ?? 1, legendPosition = a.legendPosition ?? 'BOTTOM_LEGEND';
  const ranges: Cells[] = a.ranges.map((r: { cells: string }) => {
    const c = parseCells(r.cells);
    if (extent(c.startCol, c.endCol) !== 1 && extent(c.startRow, c.endRow) !== 1)
      throw new Error(`Chart range ${r.cells} spans several rows and columns; give one column per range (e.g. B1:B7): the domain first, then one range per series`);
    return c;
  });
  const source = (c: Cells) => ({ sourceRange: { sources: [gridRange(a.sheetId, c)] } });
  if (a.chartType === 'PIE') {
    if (ranges.length !== 2) throw new Error(`A PIE chart takes exactly two ranges (labels, then values), got ${ranges.length}`);
    // PieChartSpec has no headerCount, so skip the label cell of each range here.
    const body = (c: Cells) => !header ? c : extent(c.startCol, c.endCol) === 1 ? { ...c, startRow: (c.startRow ?? 0) + header } : { ...c, startCol: (c.startCol ?? 0) + header };
    return compact({ title: a.title, pieChart: { legendPosition, domain: source(body(ranges[0]!)), series: source(body(ranges[1]!)) } });
  }
  return compact({
    title: a.title,
    basicChart: {
      chartType: a.chartType, legendPosition, headerCount: header,
      domains: [{ domain: source(ranges[0]!) }],
      series: ranges.slice(1).map(c => ({ series: source(c), targetAxis: a.chartType === 'BAR' ? 'BOTTOM_AXIS' : 'LEFT_AXIS' })),
    },
  });
}

const textFields = { bold: 'bold', italic: 'italic', strikethrough: 'strikethrough', fontSize: 'fontSize', fontFamily: 'fontFamily' } as const;
/** CellFormat plus the update mask covering exactly the properties given. */
export function cellFormat(a: Args) {
  const format: any = {}, fields: string[] = [], textFormat: any = {};
  for (const [input, field] of Object.entries(textFields)) if (a[input] !== undefined) { textFormat[field] = a[input]; fields.push(`textFormat.${field}`); }
  if (a.textColor !== undefined) { textFormat.foregroundColorStyle = colorStyle(a.textColor); fields.push('textFormat.foregroundColorStyle'); }
  if (Object.keys(textFormat).length) format.textFormat = textFormat;
  if (a.backgroundColor !== undefined) { format.backgroundColorStyle = colorStyle(a.backgroundColor); fields.push('backgroundColorStyle'); }
  for (const key of ['horizontalAlignment', 'verticalAlignment', 'wrapStrategy']) if (a[key] !== undefined) { format[key] = a[key]; fields.push(key); }
  if (a.numberFormatPattern !== undefined) { format.numberFormat = { type: numberFormatType(a.numberFormatPattern), pattern: a.numberFormatPattern }; fields.push('numberFormat'); }
  if (!fields.length) throw new Error('Give at least one format property to change (e.g. bold, textColor, backgroundColor, numberFormatPattern)');
  return { format, fields: fields.map(f => `userEnteredFormat.${f}`).join(',') };
}

export const border = (style: string | undefined, hex = '#000000') => (style === undefined ? undefined : style === 'NONE' ? { style } : { style, colorStyle: colorStyle(hex) });
