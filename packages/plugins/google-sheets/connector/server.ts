import { GoogleApi, segment, servePlugin, type Args, type Tool } from '../../_shared/google';
import { compact, referenceTool } from '../../_shared/reference';
import { a1Range, columnIndex, formatCells, gridRange, parseCells, quoteSheet, type Cells } from './a1';
import { border, cellFormat, chartSpec, colorStyle, condition } from './format';
import { blockCells, checkCellCount, renderSections, writeBlocks, type Cell } from './values';

export const readCap = 16 * 1024 * 1024;
const spreadsheetFields = 'spreadsheetId,spreadsheetUrl,properties(title,locale,timeZone),sheets(properties(sheetId,title,index,sheetType,hidden,gridProperties(rowCount,columnCount,frozenRowCount,frozenColumnCount)),charts(chartId,spec(title)),protectedRanges(protectedRangeId,range,namedRangeId,description,warningOnly,requestingUserCanEdit,unprotectedRanges)),namedRanges(namedRangeId,name,range)';
const banding = { header: '#37474F', first: '#FFFFFF', second: '#F3F3F3' };

/** Accepts the bare id or a pasted docs.google.com/spreadsheets/d/<id>/... URL. */
export const idOf = (value: string) => /\/spreadsheets\/d\/([\w-]+)/.exec(value)?.[1] ?? value.trim();
const writable = (sheet: string) => {
  if (/[\\/]/.test(sheet)) throw new Error(`Tab title "${sheet}" contains "/" or "\\", which the write tools cannot address; rename the tab with rename_sheet_tab first`);
  return sheet;
};
const hint = (error: unknown) => error instanceof Error && /Unable to parse range/i.test(error.message)
  ? new Error(`${error.message}. Check the tab title against get_spreadsheet and give cells in A1 notation without the tab.`) : error;

export function sheetsTools(api = new GoogleApi('https://sheets.googleapis.com')): Tool[] {
  const ref = (name: string, run: Tool['run'], risk: 'read' | 'write' | 'destructive' = 'write') => referenceTool('sheets', name, run, { risk });
  const path = (a: Args, suffix = '') => `/v4/spreadsheets/${segment(idOf(a.spreadsheetId))}${suffix}`;
  const batch = (a: Args, ...requests: unknown[]) => api.request(path(a, ':batchUpdate'), {}, 'POST', { requests });
  const values = async (a: Args, suffix: string, query: Args, method: string, body?: unknown) => {
    try { return await api.request(path(a, suffix), query, method, body); } catch (error) { throw hint(error); }
  };
  const tabs = async (a: Args, fields: string) => ((await api.request(path(a), { fields: `sheets.properties(${fields})` })).sheets ?? []).map((s: any) => s.properties ?? {});
  /** Extend a tab's grid so a write that ends at (rows, columns) fits; false when it already does. */
  const grow = async (a: Args, sheet: string, rows: number, columns: number) => {
    const all = await tabs(a, 'sheetId,title,gridProperties(rowCount,columnCount)');
    const tab = all.find((t: any) => t.title === sheet) ?? all.find((t: any) => t.title?.toLowerCase() === sheet.toLowerCase());
    if (!tab) throw new Error(`No tab titled "${sheet}"; get_spreadsheet lists the tab titles`);
    const grid = tab.gridProperties ?? {}, requests: unknown[] = [];
    if (rows > (grid.rowCount ?? 0)) requests.push({ appendDimension: { sheetId: tab.sheetId ?? 0, dimension: 'ROWS', length: rows - (grid.rowCount ?? 0) } });
    if (columns > (grid.columnCount ?? 0)) requests.push({ appendDimension: { sheetId: tab.sheetId ?? 0, dimension: 'COLUMNS', length: columns - (grid.columnCount ?? 0) } });
    if (requests.length) await batch(a, ...requests);
    return requests.length > 0;
  };
  const dimensions = (a: Args) => ({ sheetId: a.sheetId, dimension: a.dimension, startIndex: a.position - 1, endIndex: a.position - 1 + (a.count ?? 1) });
  const inputOption = (a: Args) => (a.parseInput ? 'USER_ENTERED' : 'RAW');
  return [
    ref('get_spreadsheet', async a => {
      const s = await api.request(path(a), { fields: spreadsheetFields, includeGridData: false });
      // JSON omits zero-valued ids and positions; restore them so every tab has a sheetId and index.
      for (const tab of s.sheets ?? []) tab.properties = { sheetId: 0, index: 0, ...tab.properties };
      return s;
    }, 'read'),
    ref('create_spreadsheet', async a => {
      const titles: string[] | undefined = a.sheetTitles;
      if (titles && new Set(titles.map(t => t.toLowerCase())).size !== titles.length) throw new Error('sheetTitles must be unique (Sheets compares tab titles case-insensitively)');
      const s = await api.request('/v4/spreadsheets', { fields: 'spreadsheetId,spreadsheetUrl,properties.title,sheets.properties(sheetId,title,index)' }, 'POST',
        compact({ properties: { title: a.title }, sheets: titles?.map((title, index) => ({ properties: { title, index } })) }));
      return { spreadsheetId: s.spreadsheetId, spreadsheetUrl: s.spreadsheetUrl, title: s.properties?.title, sheets: (s.sheets ?? []).map((t: any) => ({ sheetId: t.properties?.sheetId ?? 0, title: t.properties?.title })) };
    }),
    ref('read_range', async a => {
      const maxChars = Math.min(a.maxChars ?? 100_000, 250_000);
      let first: string | undefined;
      if (a.ranges.some((r: Args) => r.sheet === undefined && r.cells === undefined)) {
        first = (await tabs(a, 'title,hidden')).find((t: any) => !t.hidden)?.title;
        if (first === undefined) throw new Error('The spreadsheet has no visible tab; name the tab in sheet');
      }
      const ranges = a.ranges.map((r: Args) => (r.sheet === undefined && r.cells === undefined ? a1Range(first) : a1Range(r.sheet, r.cells)));
      let reply;
      try {
        reply = await api.request(path(a, '/values:batchGet'), { ranges, valueRenderOption: a.valueRenderOption ?? 'FORMATTED_VALUE', majorDimension: 'ROWS' }, 'GET', undefined, { maxBytes: readCap });
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Google response exceeds'))
          throw new Error(`The requested ranges exceed the ${readCap / 1024 / 1024} MB raw read cap before maxChars truncation could apply. Read a row window instead (e.g. cells "1:2000"), then the next window.`);
        throw hint(error);
      }
      return { spreadsheetId: reply.spreadsheetId, ...renderSections(reply.valueRanges ?? [], maxChars) };
    }, 'read'),
    ref('write_range', async a => {
      const sheet = writable(a.sheet), target = parseCells(a.cells), rows: Cell[][] = a.values;
      checkCellCount(rows);
      const top = target.startRow ?? 0, left = target.startCol ?? 0, height = rows.length, width = Math.max(0, ...rows.map(r => r.length));
      const anchor = target.endRow! - target.startRow! === 1 && target.endCol! - target.startCol! === 1;
      if (!anchor && ((target.endRow !== undefined && height > target.endRow - top) || (target.endCol !== undefined && width > target.endCol - left)))
        throw new Error(`values span ${height} rows x ${width} columns, which does not fit cells ${formatCells(target)}; give the top-left cell or a range that holds every value`);
      const blocks = writeBlocks(rows);
      if (!blocks.length) return { spreadsheetId: idOf(a.spreadsheetId), updatedRange: null, updatedCells: 0 };
      const body = { valueInputOption: inputOption(a), data: blocks.map(b => ({ range: `${quoteSheet(sheet)}!${formatCells(blockCells(b, top, left))}`, majorDimension: 'ROWS', values: b.values })) };
      const send = () => values(a, '/values:batchUpdate', {}, 'POST', body);
      let reply;
      try { reply = await send(); } catch (error) {
        // values.batchUpdate is all-or-nothing, so growing the grid and retrying once is safe.
        if (!(error instanceof Error && /exceeds grid limits/i.test(error.message)) || !(await grow(a, sheet, top + height, left + width))) throw error;
        reply = await send();
      }
      const responses = reply.responses ?? [];
      if (responses.length === 1) return { spreadsheetId: reply.spreadsheetId, updatedRange: responses[0].updatedRange, updatedCells: responses[0].updatedCells ?? 0 };
      const cells = blocks.map(b => blockCells(b, top, left));
      const box: Cells = { startRow: Math.min(...cells.map(c => c.startRow!)), endRow: Math.max(...cells.map(c => c.endRow!)), startCol: Math.min(...cells.map(c => c.startCol!)), endCol: Math.max(...cells.map(c => c.endCol!)) };
      const first: string = responses[0]?.updatedRange ?? '', at = first.lastIndexOf('!');
      return { spreadsheetId: reply.spreadsheetId, updatedRange: `${at < 0 ? quoteSheet(sheet) : first.slice(0, at)}!${formatCells(box)}`, updatedCells: reply.totalUpdatedCells ?? 0, updatedRanges: responses.map((r: any) => r.updatedRange) };
    }),
    ref('append_rows', a => {
      const range = a1Range(writable(a.sheet), a.cells);
      checkCellCount(a.values);
      return values(a, `/values/${encodeURIComponent(range)}:append`, { valueInputOption: inputOption(a), insertDataOption: a.insertRows === false ? 'OVERWRITE' : 'INSERT_ROWS' }, 'POST', { majorDimension: 'ROWS', values: a.values });
    }),
    ref('append_values', a => {
      checkCellCount(a.values);
      return values(a, `/values/${encodeURIComponent(a.range.trim())}:append`, { valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' }, 'POST', { majorDimension: 'ROWS', values: a.values });
    }),
    ref('clear_range', a => values(a, `/values/${encodeURIComponent(a1Range(writable(a.sheet), a.cells))}:clear`, {}, 'POST', {}), 'destructive'),
    ref('batch_clear_values', a => values(a, '/values:batchClear', {}, 'POST', { ranges: a.ranges.map((r: string) => r.trim()) }), 'destructive'),
    ref('add_sheet_tab', a => batch(a, { addSheet: { properties: compact({ title: a.title, index: a.index }) } })),
    ref('rename_sheet_tab', a => batch(a, { updateSheetProperties: { properties: { sheetId: a.sheetId, title: a.title }, fields: 'title' } })),
    ref('delete_sheet_tab', a => batch(a, { deleteSheet: { sheetId: a.sheetId } }), 'destructive'),
    ref('copy_sheet_to_another_spreadsheet', a => api.request(path(a, `/sheets/${a.sheetId}:copyTo`), {}, 'POST', { destinationSpreadsheetId: idOf(a.destinationSpreadsheetId) })),
    ref('insert_rows_or_columns', a => {
      if (a.inheritBefore && a.position === 1) throw new Error('inheritBefore needs a row or column before the insertion point, and position 1 has none');
      return batch(a, { insertDimension: { range: dimensions(a), inheritFromBefore: a.inheritBefore ?? false } });
    }),
    ref('delete_rows_or_columns', a => batch(a, { deleteDimension: { range: dimensions(a) } }), 'destructive'),
    ref('set_column_width', a => batch(a, { updateDimensionProperties: { range: dimensions(a), properties: { pixelSize: a.pixelSize }, fields: 'pixelSize' } })),
    ref('freeze_rows_or_columns', a => {
      const grid = compact({ frozenRowCount: a.frozenRowCount, frozenColumnCount: a.frozenColumnCount });
      if (!Object.keys(grid).length) throw new Error('Give frozenRowCount and/or frozenColumnCount (0 unfreezes)');
      return batch(a, { updateSheetProperties: { properties: { sheetId: a.sheetId, gridProperties: grid }, fields: Object.keys(grid).map(k => `gridProperties.${k}`).join(',') } });
    }),
    ref('format_cells', a => {
      const { format, fields } = cellFormat(a);
      return batch(a, { repeatCell: { range: gridRange(a.sheetId, a.cells), cell: { userEnteredFormat: format }, fields } });
    }),
    ref('set_borders', a => {
      if (a.outer === undefined && a.inner === undefined) throw new Error('Give an outer and/or inner border style (NONE removes a border)');
      const outer = border(a.outer, a.color), inner = border(a.inner, a.color);
      return batch(a, { updateBorders: compact({ range: gridRange(a.sheetId, a.cells), top: outer, bottom: outer, left: outer, right: outer, innerHorizontal: inner, innerVertical: inner }) });
    }),
    ref('merge_cells', a => {
      const range = gridRange(a.sheetId, a.cells);
      return batch(a, a.mergeType === 'UNMERGE' ? { unmergeCells: { range } } : { mergeCells: { range, mergeType: a.mergeType } });
    }),
    ref('add_banding', a => batch(a, { addBanding: { bandedRange: { range: gridRange(a.sheetId, a.cells), rowProperties: {
      headerColorStyle: colorStyle(a.headerColor ?? banding.header), firstBandColorStyle: colorStyle(a.firstBandColor ?? banding.first), secondBandColorStyle: colorStyle(a.secondBandColor ?? banding.second),
    } } } })),
    ref('add_conditional_formatting', a => {
      const textFormat = compact({ bold: a.bold, foregroundColorStyle: colorStyle(a.textColor) });
      const format = compact({ textFormat: Object.keys(textFormat).length ? textFormat : undefined, backgroundColorStyle: colorStyle(a.backgroundColor) });
      if (!Object.keys(format).length) throw new Error('Give the format to apply when the condition holds: bold, textColor and/or backgroundColor');
      // Index 0 gives the new rule priority over existing rules on overlapping cells.
      return batch(a, { addConditionalFormatRule: { index: 0, rule: { ranges: [gridRange(a.sheetId, a.cells)], booleanRule: { condition: condition(a.conditionType, a.conditionValues), format } } } });
    }),
    ref('set_data_validation', a => {
      const range = gridRange(a.sheetId, a.cells);
      if (!a.conditionType) {
        if (a.conditionValues?.length) throw new Error('conditionValues needs a conditionType; omit both to clear validation');
        return batch(a, { setDataValidation: { range } });
      }
      const list = a.conditionType === 'ONE_OF_LIST';
      return batch(a, { setDataValidation: { range, rule: compact({ condition: condition(a.conditionType, a.conditionValues, list), strict: a.strict ?? true, showCustomUi: list || undefined }) } });
    }),
    ref('sort_range', a => {
      const c = parseCells(a.cells);
      const sortSpecs = a.sortBy.map((s: Args) => {
        const dimensionIndex = columnIndex(s.column);
        if ((c.startCol !== undefined && dimensionIndex < c.startCol) || (c.endCol !== undefined && dimensionIndex >= c.endCol))
          throw new Error(`Sort column ${s.column.toUpperCase()} is outside the sorted range ${formatCells(c)}; name columns by their absolute letter inside the range`);
        return { dimensionIndex, sortOrder: s.descending ? 'DESCENDING' : 'ASCENDING' };
      });
      return batch(a, { sortRange: { range: gridRange(a.sheetId, c), sortSpecs } });
    }),
    ref('set_basic_filter', a => batch(a, a.cells === undefined ? { clearBasicFilter: { sheetId: a.sheetId } } : { setBasicFilter: { filter: { range: gridRange(a.sheetId, a.cells) } } })),
    ref('find_replace_sheet', a => batch(a, { findReplace: compact({
      find: a.find, replacement: a.replacement, matchCase: a.matchCase ?? false, matchEntireCell: a.matchEntireCell ?? false, searchByRegex: false,
      includeFormulas: a.searchFormulas ?? false, sheetId: a.sheetId, allSheets: a.sheetId === undefined ? true : undefined,
    }) })),
    ref('add_chart', a => {
      const anchor = parseCells(a.anchorCell ?? 'E2');
      return batch(a, { addChart: { chart: { spec: chartSpec(a), position: { overlayPosition: { anchorCell: { sheetId: a.sheetId, rowIndex: anchor.startRow ?? 0, columnIndex: anchor.startCol ?? 0 } } } } } });
    }),
    ref('update_chart', a => batch(a, { updateChartSpec: { chartId: a.chartId, spec: chartSpec(a) } })),
    ref('delete_chart', a => batch(a, { deleteEmbeddedObject: { objectId: a.chartId } }), 'destructive'),
    ref('add_named_range', a => {
      if (/^[A-Za-z]{1,3}\d+$/.test(a.name) || /^R\d*C\d*$/i.test(a.name) || /^(true|false)$/i.test(a.name))
        throw new Error(`"${a.name}" looks like a cell reference or boolean; choose a name such as Budget_2026`);
      return batch(a, { addNamedRange: { namedRange: { name: a.name, range: gridRange(a.sheetId, a.cells) } } });
    }),
    ref('delete_named_range', a => batch(a, { deleteNamedRange: { namedRangeId: a.namedRangeId } }), 'destructive'),
    ref('protect_range', a => batch(a, { addProtectedRange: { protectedRange: compact({ range: gridRange(a.sheetId, a.cells), description: a.description, warningOnly: a.warningOnly ?? true }) } })),
    ref('unprotect_range', a => batch(a, { deleteProtectedRange: { protectedRangeId: a.protectedRangeId } }), 'destructive'),
  ];
}
if (import.meta.main) await servePlugin('openteam-google-sheets', sheetsTools());
