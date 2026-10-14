import { expect, test } from 'bun:test';
import { createToolValidator } from '@openteam/plugin-sdk/json-schema';
import { GoogleApi } from '../../../_shared/google';
import { referenceTools } from '../../../_shared/reference';
import { harness } from '../../../test/parity-harness';
import { docsTools } from '../server';

const run = (start: number, content: string, textStyle: any = {}) => ({ startIndex: start, endIndex: start + content.length, textRun: { content, textStyle } });
const para = (start: number, content: string, extra: any = {}) => ({ startIndex: start, endIndex: start + content.length, paragraph: { elements: [run(start, content)], paragraphStyle: { namedStyleType: 'NORMAL_TEXT' }, ...extra } });
const sectionBreak = { endIndex: 1, sectionBreak: { sectionStyle: {} } };
const table = (start: number, rows: string[][]) => {
  let i = start + 1;
  const tableRows = rows.map(r => {
    const rowStart = i++;
    const tableCells = r.map(t => { const cellStart = i++; const p = para(i, `${t}\n`); i = p.endIndex; return { startIndex: cellStart, endIndex: i, content: [p], tableCellStyle: { rowSpan: 1, columnSpan: 1 } }; });
    return { startIndex: rowStart, endIndex: i, tableCells };
  });
  return { startIndex: start, endIndex: i + 1, table: { rows: rows.length, columns: rows[0]!.length, tableRows } };
};
const doc = (content: any[], documentTab: any = {}, tabs: any[] = []) => ({ documentId: 'doc', title: 'Plan', revisionId: 'rev-1',
  tabs: [{ tabProperties: { tabId: 't.0', title: 'Tab 1', index: 0 }, documentTab: { body: { content }, ...documentTab } }, ...tabs] });
const written = { documentId: 'doc', replies: [{}], writeControl: { requiredRevisionId: 'rev-2' } };
const plain = 'namedStyleType,alignment,lineSpacing,indentFirstLine,indentStart,indentEnd,spaceAbove,spaceBelow,shading';

const sample = () => doc([
  sectionBreak,
  para(1, 'Plan\n', { paragraphStyle: { namedStyleType: 'TITLE', alignment: 'CENTER' } }),
  { startIndex: 6, endIndex: 18, paragraph: { elements: [run(6, 'Hello '), run(12, 'world', { bold: true, link: { url: 'https://example.com' }, foregroundColor: { color: { rgbColor: { red: 1 } } } }), run(17, '\n')], paragraphStyle: { namedStyleType: 'NORMAL_TEXT' } } },
  para(18, 'Milk\n', { bullet: { listId: 'kix.1' } }),
  para(23, 'Step\n', { bullet: { listId: 'kix.2', nestingLevel: 1 } }),
  table(28, [['A', 'B']]),
  para(37, 'End 😀\n'),
], {
  lists: { 'kix.1': { listProperties: { nestingLevels: [{ glyphSymbol: '●' }] } }, 'kix.2': { listProperties: { nestingLevels: [{ glyphType: 'DECIMAL' }, { glyphType: 'ALPHA' }] } } },
  headers: { 'h.1': { headerId: 'h.1', content: [para(0, 'Confidential\n')] } }, documentStyle: { defaultHeaderId: 'h.1' },
}, [{ tabProperties: { tabId: 't.1', title: 'Notes', index: 1 }, documentTab: { body: { content: [sectionBreak, para(1, 'Second tab\n')] } },
  childTabs: [{ tabProperties: { tabId: 't.2', title: 'Child', parentTabId: 't.1', nestingLevel: 1 }, documentTab: { body: { content: [sectionBreak, para(1, '\n')] } } }] }]);

test('Docs exposes exactly the pinned tools, schemas and risk levels', () => {
  const tools = docsTools(new GoogleApi('https://docs.googleapis.com', 'token'));
  expect(tools.map(t => t.name).sort()).toEqual(referenceTools.docs.map(t => t.name).sort());
  for (const reference of referenceTools.docs) {
    const tool = tools.find(t => t.name === reference.name)!;
    expect(tool.description).toBe(reference.description);
    expect(tool.inputSchema.properties).toEqual(reference.inputSchema.properties as any);
    expect(tool.inputSchema.required).toEqual(reference.inputSchema.required);
    expect(tool.annotations.readOnlyHint).toBe(Boolean(reference.annotations.readOnlyHint));
    expect(tool.annotations.destructiveHint).toBe(reference.name === 'delete_content');
    expect(createToolValidator(tool.inputSchema)({ documentId: 'doc', unexpected: true }).valid).toBe(false);
  }
  const createList = createToolValidator(tools.find(t => t.name === 'create_list')!.inputSchema);
  expect(createList({ documentId: 'doc', startIndex: 3, endIndex: 9 }).valid).toBe(true);
  expect(createList({ documentId: 'doc', startIndex: 3, endIndex: 0 }).valid).toBe(false);
});

test('read_document returns ranges, styles, list membership, table cell content ranges, headers and tabs', async () => {
  const h = harness(docsTools, [sample()]);
  const value = await h.call('read_document', { documentId: 'https://docs.google.com/document/d/doc/edit' });
  expect(h.requests[0]!.url.pathname).toBe('/v1/documents/doc');
  expect(h.requests[0]!.url.searchParams.get('includeTabsContent')).toBe('true');
  expect(value).toMatchObject({ documentId: 'doc', title: 'Plan', revisionId: 'rev-1', tab: { tabId: 't.0', title: 'Tab 1' }, bodyEnd: 44, truncated: false });
  expect(value.tabs).toEqual([{ tabId: 't.0', title: 'Tab 1' }, { tabId: 't.1', title: 'Notes' }, { tabId: 't.2', title: 'Child', parentTabId: 't.1', nestingLevel: 1 }]);
  expect(value.headers).toEqual([{ id: 'h.1', type: 'default', text: 'Confidential' }]);
  expect(value.elements).toEqual([
    { start: 1, end: 6, style: 'TITLE', text: 'Plan', format: { alignment: 'CENTER' } },
    { start: 6, end: 18, text: 'Hello world', spans: [{ start: 12, end: 17, bold: true, textColor: '#FF0000', linkUrl: 'https://example.com' }] },
    { start: 18, end: 23, text: '• Milk', list: { listId: 'kix.1' } },
    { start: 23, end: 28, text: '• Step', list: { listId: 'kix.2', level: 1, numbered: true } },
    { start: 28, end: 37, table: '1x2', cells: [{ row: 0, column: 0, start: 31, end: 33, text: 'A' }, { row: 0, column: 1, start: 34, end: 36, text: 'B' }] },
    { start: 37, end: 44, text: 'End 😀' },
  ]);
});

test('read_document truncates on element boundaries, resumes from nextStartIndex and selects tabs', async () => {
  const full = (await harness(docsTools, [sample()]).call('read_document', { documentId: 'doc' })).elements;
  const maxChars = JSON.stringify(full[0]).length + JSON.stringify(full[1]).length;
  const h = harness(docsTools, [sample(), sample(), sample(), sample(), sample()]);
  const first = await h.call('read_document', { documentId: 'doc', maxChars });
  expect(first.elements).toEqual(full.slice(0, 2));
  expect(first).toMatchObject({ truncated: true, nextStartIndex: 18 });
  const rest = await h.call('read_document', { documentId: 'doc', startIndex: 18 });
  expect(rest.elements).toEqual(full.slice(2));
  expect(rest.truncated).toBe(false);
  await expect(h.call('read_document', { documentId: 'doc', maxChars: 10 })).rejects.toThrow('Raise maxChars');
  const child = await h.call('read_document', { documentId: 'doc', tabId: 't.1' });
  expect(child.tab).toEqual({ tabId: 't.1', title: 'Notes' });
  expect(child.elements).toEqual([{ start: 1, end: 12, text: 'Second tab' }]);
  await expect(h.call('read_document', { documentId: 'doc', tabId: 'missing' })).rejects.toThrow('Available tabs: t.0 (Tab 1), t.1 (Notes), t.2 (Child)');
});

test('find_text returns fresh UTF-16 ranges in paragraphs and cells, never across cells', async () => {
  const h = harness(docsTools, Array.from({ length: 5 }, sample));
  const world = await h.call('find_text', { documentId: 'doc', text: 'world' });
  expect(world).toEqual({ documentId: 'doc', revisionId: 'rev-1', tabId: 't.0', totalMatches: 1, matches: [{ start: 12, end: 17, paragraph_start: 6, paragraph_end: 18, paragraph_text: 'Hello world' }] });
  expect((await h.call('find_text', { documentId: 'doc', text: '😀' })).matches[0]).toMatchObject({ start: 41, end: 43, paragraph_start: 37 });
  expect((await h.call('find_text', { documentId: 'doc', text: 'B' })).matches[0]).toMatchObject({ start: 34, end: 35, paragraph_text: 'B' });
  expect((await h.call('find_text', { documentId: 'doc', text: 'A\nB' })).matches).toEqual([]);
  expect((await h.call('find_text', { documentId: 'doc', text: 'o', occurrence: 2 })).matches).toEqual([{ start: 13, end: 14, paragraph_start: 6, paragraph_end: 18, paragraph_text: 'Hello world' }]);
  const many = harness(docsTools, [doc([sectionBreak, ...Array.from({ length: 25 }, (_, i) => para(1 + i * 2, 'x\n'))])]);
  const capped = await many.call('find_text', { documentId: 'doc', text: 'x' });
  expect(capped.matches).toHaveLength(20);
  expect(capped).toMatchObject({ totalMatches: 25, truncated: true });
});

test('insert_text appends a plain, revision-guarded paragraph after a list with style in one batchUpdate', async () => {
  const h = harness(docsTools, [doc([sectionBreak, para(1, 'Intro\n'), para(7, 'Item\n', { bullet: { listId: 'kix.1' } })]), written]);
  const value = await h.call('insert_text', { documentId: 'doc', text: 'Next steps', paragraphStyle: 'HEADING_2', bold: true });
  expect(h.requests[1]!.url.pathname).toBe('/v1/documents/doc:batchUpdate');
  expect(h.requests[1]!.init.method).toBe('POST');
  const range = { startIndex: 12, endIndex: 22, tabId: 't.0' };
  expect(h.requests[1]!.json).toEqual({ requests: [
    { insertText: { location: { index: 11, tabId: 't.0' }, text: '\nNext steps' } },
    { deleteParagraphBullets: { range } },
    { updateParagraphStyle: { range, paragraphStyle: { namedStyleType: 'HEADING_2' }, fields: plain } },
    { updateTextStyle: { range, textStyle: { bold: true }, fields: '*' } },
  ], writeControl: { requiredRevisionId: 'rev-1' } });
  expect(value).toEqual({ documentId: 'doc', tabId: 't.0', insertedRange: { start: 12, end: 22 }, revisionId: 'rev-2' });
});

test('insert_text append fills an empty final paragraph and counts surrogate pairs as two units', async () => {
  const h = harness(docsTools, [doc([sectionBreak, para(1, '\n')]), written]);
  const value = await h.call('insert_text', { documentId: 'doc', text: 'Hi 😀', requiredRevisionId: 'mine' });
  const range = { startIndex: 1, endIndex: 6, tabId: 't.0' };
  expect(h.requests[1]!.json).toEqual({ requests: [
    { insertText: { location: { index: 1, tabId: 't.0' }, text: 'Hi 😀' } },
    { updateParagraphStyle: { range, paragraphStyle: { namedStyleType: 'NORMAL_TEXT' }, fields: plain } },
    { updateTextStyle: { range, textStyle: {}, fields: '*' } },
  ], writeControl: { requiredRevisionId: 'mine' } });
  expect(value.insertedRange).toEqual({ start: 1, end: 6 });
});

test('insert_text at an index inserts in place, passes requiredRevisionId and strips characters Docs would drop', async () => {
  const h = harness(docsTools, [written, written]);
  const value = await h.call('insert_text', { documentId: 'doc', index: 5, tabId: 't.2', text: 'a\r\nb\u0001', italic: true, paragraphStyle: 'HEADING_1', requiredRevisionId: 'rev-9' });
  const range = { startIndex: 5, endIndex: 8, tabId: 't.2' };
  expect(h.requests[0]!.json).toEqual({ requests: [
    { insertText: { location: { index: 5, tabId: 't.2' }, text: 'a\nb' } },
    { updateParagraphStyle: { range, paragraphStyle: { namedStyleType: 'HEADING_1' }, fields: 'namedStyleType' } },
    { updateTextStyle: { range, textStyle: { italic: true }, fields: 'italic' } },
  ], writeControl: { requiredRevisionId: 'rev-9' } });
  expect(value).toEqual({ documentId: 'doc', tabId: 't.2', insertedRange: { start: 5, end: 8 }, revisionId: 'rev-2' });
  await h.call('insert_text', { documentId: 'doc', index: 1, text: 'x' });
  expect(h.requests[1]!.json).toEqual({ requests: [{ insertText: { location: { index: 1 }, text: 'x' } }] });
  await expect(h.call('insert_text', { documentId: 'doc', index: 1, text: '\u0001' })).rejects.toThrow('empty');
});

test('create_list resolves text anchors, strips old membership and guards with the read revision', async () => {
  const body = doc([sectionBreak, para(1, 'Shopping\n'), para(10, 'Milk\n', { bullet: { listId: 'old' } }), para(15, 'Eggs\n'), para(20, 'Bread\n'), para(26, 'Done\n')]);
  const h = harness(docsTools, [body, written, written, body, body, body, written]);
  const value = await h.call('create_list', { documentId: 'doc', firstItemText: '• Milk', lastItemText: 'Bread', bulletPreset: 'NUMBERED_DECIMAL_NESTED' });
  const range = { startIndex: 10, endIndex: 25, tabId: 't.0' };
  expect(h.requests[1]!.json).toEqual({ requests: [
    { deleteParagraphBullets: { range } },
    { updateParagraphStyle: { range, paragraphStyle: {}, fields: 'indentStart,indentFirstLine' } },
    { createParagraphBullets: { range, bulletPreset: 'NUMBERED_DECIMAL_NESTED' } },
  ], writeControl: { requiredRevisionId: 'rev-1' } });
  expect(value.range).toEqual({ start: 10, end: 25 });
  await h.call('create_list', { documentId: 'doc', startIndex: 10, endIndex: 25, remove: true });
  expect(h.requests[2]!.json).toEqual({ requests: [
    { deleteParagraphBullets: { range: { startIndex: 10, endIndex: 25 } } },
    { updateParagraphStyle: { range: { startIndex: 10, endIndex: 25 }, paragraphStyle: {}, fields: 'indentStart,indentFirstLine' } },
  ] });
  await expect(h.call('create_list', { documentId: 'doc', firstItemText: 'Milk', startIndex: 1, endIndex: 5 })).rejects.toThrow('exactly one');
  await expect(h.call('create_list', { documentId: 'doc' })).rejects.toThrow('exactly one');
  await expect(h.call('create_list', { documentId: 'doc', firstItemText: 'Milk', lastItemText: 'Shopping' })).rejects.toThrow('lastItemText');
  await expect(h.call('create_list', { documentId: 'doc', firstItemText: 'Nothing' })).rejects.toThrow('No paragraph starts');
  const single = await h.call('create_list', { documentId: 'doc', firstItemText: 'Eggs' });
  expect(single.range).toEqual({ start: 15, end: 19 });
  const twice = harness(docsTools, [doc([sectionBreak, para(1, 'Milk\n'), para(6, 'Milk shake\n')])]);
  await expect(twice.call('create_list', { documentId: 'doc', firstItemText: 'Milk', lastItemText: 'Milk shake' })).rejects.toThrow('starts 2 paragraphs (at 1, 6)');
});

test('apply_text_style maps every character property and validates the range', async () => {
  const h = harness(docsTools, [written]);
  await h.call('apply_text_style', { documentId: 'doc', startIndex: 3, endIndex: 9, tabId: 't.1', requiredRevisionId: 'r', bold: true, underline: false, italic: true, strikethrough: true,
    fontSize: 14, fontFamily: 'Georgia', textColor: '#FF0000', backgroundColor: '#00ff00', linkUrl: 'https://example.com' });
  expect(h.requests[0]!.json).toEqual({ requests: [{ updateTextStyle: { range: { startIndex: 3, endIndex: 9, tabId: 't.1' }, textStyle: {
    bold: true, italic: true, underline: false, strikethrough: true, fontSize: { magnitude: 14, unit: 'PT' }, weightedFontFamily: { fontFamily: 'Georgia' },
    foregroundColor: { color: { rgbColor: { red: 1, green: 0, blue: 0 } } }, backgroundColor: { color: { rgbColor: { red: 0, green: 1, blue: 0 } } }, link: { url: 'https://example.com' },
  }, fields: 'bold,italic,underline,strikethrough,fontSize,weightedFontFamily,foregroundColor,backgroundColor,link' } }], writeControl: { requiredRevisionId: 'r' } });
  await expect(h.call('apply_text_style', { documentId: 'doc', startIndex: 3, endIndex: 9 })).rejects.toThrow('at least one');
  await expect(h.call('apply_text_style', { documentId: 'doc', startIndex: 9, endIndex: 9, bold: true })).rejects.toThrow('greater than startIndex');
  expect(h.requests).toHaveLength(1);
});

test('paragraph style, paragraph format and replace_text map to their batchUpdate requests', async () => {
  const h = harness(docsTools, [written, written, written, written]);
  await h.call('apply_paragraph_style', { documentId: 'doc', startIndex: 1, endIndex: 6, namedStyleType: 'HEADING_3' });
  expect(h.requests[0]!.json.requests).toEqual([{ updateParagraphStyle: { range: { startIndex: 1, endIndex: 6 }, paragraphStyle: { namedStyleType: 'HEADING_3' }, fields: 'namedStyleType' } }]);
  await h.call('set_paragraph_format', { documentId: 'doc', startIndex: 1, endIndex: 6, alignment: 'CENTER', indentStart: 36, lineSpacing: 150, requiredRevisionId: 'r' });
  expect(h.requests[1]!.json).toEqual({ requests: [{ updateParagraphStyle: { range: { startIndex: 1, endIndex: 6 }, paragraphStyle: { alignment: 'CENTER', indentStart: { magnitude: 36, unit: 'PT' }, lineSpacing: 150 }, fields: 'alignment,indentStart,lineSpacing' } }], writeControl: { requiredRevisionId: 'r' } });
  await expect(h.call('set_paragraph_format', { documentId: 'doc', startIndex: 1, endIndex: 6 })).rejects.toThrow('at least one');
  await h.call('replace_text', { documentId: 'doc', find: 'Q3', replace: 'Q4', tabIds: ['t.1'] });
  expect(h.requests[2]!.json.requests).toEqual([{ replaceAllText: { containsText: { text: 'Q3', matchCase: true }, replaceText: 'Q4', tabsCriteria: { tabIds: ['t.1'] } } }]);
  await h.call('replace_text', { documentId: 'doc', find: 'draft', replace: '', matchCase: false, requiredRevisionId: 'r' });
  expect(h.requests[3]!.json).toEqual({ requests: [{ replaceAllText: { containsText: { text: 'draft', matchCase: false }, replaceText: '' } }], writeControl: { requiredRevisionId: 'r' } });
});

test('delete_content rejects surrogate splits, table structure and final newlines before writing', async () => {
  // 'Hi 😀 there' puts the emoji's two code units at 4 and 5.
  const body = () => doc([sectionBreak, para(1, 'Hi 😀 there\n'), para(13, 'Before\n'), table(20, [['A', 'B']]), para(29, 'Tail\n')]);
  const h = harness(docsTools, Array.from({ length: 8 }, body));
  const rejects = async (startIndex: number, endIndex: number, message: string) => expect(h.call('delete_content', { documentId: 'doc', startIndex, endIndex })).rejects.toThrow(message);
  await rejects(5, 8, 'splits a surrogate pair');
  await rejects(24, 27, 'splits the table at 20');
  await rejects(29, 34, 'final newline of the tab body');
  await rejects(15, 20, 'newline before the table at 20');
  await rejects(23, 25, 'final newline of the table cell');
  await expect(h.call('delete_content', { documentId: 'doc', startIndex: 5, endIndex: 5 })).rejects.toThrow('greater than startIndex');
  expect(h.requests).toHaveLength(5);
  const ok = harness(docsTools, [body(), written, body(), written, body(), written]);
  await ok.call('delete_content', { documentId: 'doc', startIndex: 23, endIndex: 24 });
  expect(ok.requests[1]!.json).toEqual({ requests: [{ deleteContentRange: { range: { startIndex: 23, endIndex: 24, tabId: 't.0' } } }], writeControl: { requiredRevisionId: 'rev-1' } });
  await ok.call('delete_content', { documentId: 'doc', startIndex: 13, endIndex: 29, requiredRevisionId: 'mine' });
  expect(ok.requests[3]!.json.writeControl).toEqual({ requiredRevisionId: 'mine' });
  await ok.call('delete_content', { documentId: 'doc', startIndex: 4, endIndex: 6 });
  expect(ok.requests[5]!.json.requests[0].deleteContentRange.range).toEqual({ startIndex: 4, endIndex: 6, tabId: 't.0' });
});

test('tables, images and page breaks use location or end-of-segment placement', async () => {
  const h = harness(docsTools, Array.from({ length: 8 }, () => written));
  await h.call('insert_table', { documentId: 'doc', rows: 2, columns: 3 });
  expect(h.requests[0]!.json.requests).toEqual([{ insertTable: { rows: 2, columns: 3, endOfSegmentLocation: {} } }]);
  await h.call('insert_table', { documentId: 'doc', rows: 1, columns: 1, index: 5, tabId: 't.1', requiredRevisionId: 'r' });
  expect(h.requests[1]!.json).toEqual({ requests: [{ insertTable: { rows: 1, columns: 1, location: { index: 5, tabId: 't.1' } } }], writeControl: { requiredRevisionId: 'r' } });
  await h.call('insert_image', { documentId: 'doc', imageUrl: 'https://example.com/a.png', width: 200 });
  expect(h.requests[2]!.json.requests).toEqual([{ insertInlineImage: { uri: 'https://example.com/a.png', endOfSegmentLocation: {}, objectSize: { width: { magnitude: 200, unit: 'PT' } } } }]);
  await h.call('insert_image', { documentId: 'doc', imageUrl: 'https://example.com/b.gif', index: 4 });
  expect(h.requests[3]!.json.requests).toEqual([{ insertInlineImage: { uri: 'https://example.com/b.gif', location: { index: 4 } } }]);
  await expect(h.call('insert_image', { documentId: 'doc', imageUrl: 'file:///etc/passwd' })).rejects.toThrow('http(s)');
  await h.call('insert_page_break', { documentId: 'doc', index: 7, tabId: 't.0' });
  expect(h.requests[4]!.json.requests).toEqual([{ insertPageBreak: { location: { index: 7, tabId: 't.0' } } }]);
  await h.call('merge_table_cells', { documentId: 'doc', tableStartIndex: 20, rowIndex: 0, columnIndex: 1, rowSpan: 1, columnSpan: 2 });
  expect(h.requests[5]!.json.requests).toEqual([{ mergeTableCells: { tableRange: { tableCellLocation: { tableStartLocation: { index: 20 }, rowIndex: 0, columnIndex: 1 }, rowSpan: 1, columnSpan: 2 } } }]);
  await expect(h.call('merge_table_cells', { documentId: 'doc', tableStartIndex: 20, rowIndex: 0, columnIndex: 0, rowSpan: 1, columnSpan: 1 })).rejects.toThrow('at least two');
  await h.call('set_table_column_width', { documentId: 'doc', tableStartIndex: 20, columnIndices: [0, 2, 0], widthPt: 120, tabId: 't.1' });
  expect(h.requests[6]!.json.requests).toEqual([{ updateTableColumnProperties: { tableStartLocation: { index: 20, tabId: 't.1' }, columnIndices: [0, 2], tableColumnProperties: { widthType: 'FIXED_WIDTH', width: { magnitude: 120, unit: 'PT' } }, fields: 'widthType,width' } }]);
  await h.call('set_table_cell_shading', { documentId: 'doc', tableStartIndex: 20, rowIndex: 0, columnIndex: 0, fillColor: '#336699', columnSpan: 3 });
  expect(h.requests[7]!.json.requests).toEqual([{ updateTableCellStyle: { tableRange: { tableCellLocation: { tableStartLocation: { index: 20 }, rowIndex: 0, columnIndex: 0 }, rowSpan: 1, columnSpan: 3 },
    tableCellStyle: { backgroundColor: { color: { rgbColor: { red: 0x33 / 255, green: 0x66 / 255, blue: 0x99 / 255 } } } }, fields: 'backgroundColor' } }]);
});

test('set_header_footer creates a missing header, then writes its text guarded by the create revision', async () => {
  const h = harness(docsTools, [doc([sectionBreak, para(1, '\n')]), { replies: [{ createHeader: { headerId: 'kix.h1' } }], writeControl: { requiredRevisionId: 'rev-2' } }, { writeControl: { requiredRevisionId: 'rev-3' } }]);
  expect(await h.call('set_header_footer', { documentId: 'doc', kind: 'header', text: 'Draft\nInternal' })).toEqual({ segmentId: 'kix.h1', revisionId: 'rev-3' });
  expect(h.requests[1]!.json).toEqual({ requests: [{ createHeader: { type: 'DEFAULT' } }], writeControl: { requiredRevisionId: 'rev-1' } });
  expect(h.requests[2]!.json).toEqual({ requests: [{ insertText: { location: { segmentId: 'kix.h1', index: 0 }, text: 'Draft\nInternal' } }], writeControl: { requiredRevisionId: 'rev-2' } });
});

test('set_header_footer replaces or clears existing text on the first tab and skips a no-op', async () => {
  const withFooter = () => doc([sectionBreak, para(1, '\n')], { footers: { 'kix.f1': { footerId: 'kix.f1', content: [para(0, 'Old footer\n')] } }, documentStyle: { defaultFooterId: 'kix.f1' } },
    [{ tabProperties: { tabId: 't.1', title: 'Other' }, documentTab: { body: { content: [] } } }]);
  const h = harness(docsTools, [withFooter(), { writeControl: { requiredRevisionId: 'rev-2' } }, withFooter(), { writeControl: { requiredRevisionId: 'rev-3' } }]);
  expect(await h.call('set_header_footer', { documentId: 'doc', kind: 'footer', text: 'Page footer', requiredRevisionId: 'mine' })).toEqual({ segmentId: 'kix.f1', revisionId: 'rev-2' });
  expect(h.requests[1]!.json).toEqual({ requests: [
    { deleteContentRange: { range: { segmentId: 'kix.f1', startIndex: 0, endIndex: 10 } } },
    { insertText: { location: { segmentId: 'kix.f1', index: 0 }, text: 'Page footer' } },
  ], writeControl: { requiredRevisionId: 'mine' } });
  await h.call('set_header_footer', { documentId: 'doc', kind: 'footer', text: '' });
  expect(h.requests[3]!.json.requests).toEqual([{ deleteContentRange: { range: { segmentId: 'kix.f1', startIndex: 0, endIndex: 10 } } }]);
  const none = harness(docsTools, [doc([sectionBreak, para(1, '\n')])]);
  expect(await none.call('set_header_footer', { documentId: 'doc', kind: 'header', text: '' })).toEqual({ segmentId: null, revisionId: 'rev-1' });
  expect(none.requests).toHaveLength(1);
});

test('create_document creates a blank titled document and stale revisions explain that nothing applied', async () => {
  const h = harness(docsTools, [{ documentId: 'new-doc', title: 'Weekly notes', revisionId: 'r0', body: {} },
    new Response(JSON.stringify({ error: { code: 400, message: 'The required revision ID does not match the latest revision.' } }), { status: 400 })]);
  expect(await h.call('create_document', { title: 'Weekly notes' })).toEqual({ documentId: 'new-doc', title: 'Weekly notes', revisionId: 'r0', url: 'https://docs.google.com/document/d/new-doc/edit' });
  expect(h.requests[0]!.url.pathname).toBe('/v1/documents');
  expect(h.requests[0]!.init.method).toBe('POST');
  expect(h.requests[0]!.json).toEqual({ title: 'Weekly notes' });
  await expect(h.call('apply_paragraph_style', { documentId: 'doc', startIndex: 1, endIndex: 2, namedStyleType: 'TITLE', requiredRevisionId: 'old' })).rejects.toThrow('nothing was applied');
});

test('the stdio server lists exactly the pinned tools plus read_result', async () => {
  const child = Bun.spawn(['bun', `${import.meta.dir}/../server.ts`], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', env: { ...process.env, GOOGLE_ACCESS_TOKEN: 'x' } });
  const send = (message: any) => child.stdin.write(`${JSON.stringify(message)}\n`);
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  await child.stdin.flush();
  const reader = child.stdout.getReader(), decoder = new TextDecoder();
  let output = '', listed: any;
  while (!listed) {
    const next = await reader.read();
    if (next.done) break;
    output += decoder.decode(next.value);
    listed = output.split('\n').filter(Boolean).map(line => JSON.parse(line)).find(m => m.id === 2);
  }
  child.kill();
  expect(listed.result.tools.map((t: any) => t.name).sort()).toEqual([...referenceTools.docs.map(t => t.name), 'read_result'].sort());
}, 20_000);
