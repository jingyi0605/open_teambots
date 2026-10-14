import { GoogleApi, segment, servePlugin, type Args, type Tool } from '../../_shared/google';
import { compact, referenceTool } from '../../_shared/reference';
import { anchorRange, deleteProblem, findText, pickTab, readElement, rgb, segments, tabInventory } from './structure';

const pt = (magnitude: number) => ({ magnitude, unit: 'PT' });
const color = (value?: string) => value === undefined ? undefined : { color: { rgbColor: rgb(value) } };
// insertText strips these server-side; removing them first keeps the returned insertedRange exact.
const clean = (text: string) => text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000c-\u001f-]/g, '');
// Appended paragraphs start plain: these overrides are inherited from the paragraph that was split.
const plainParagraph = 'namedStyleType,alignment,lineSpacing,indentFirstLine,indentStart,indentEnd,spaceAbove,spaceBelow,shading';
const span = (a: Args, tabId = a.tabId) => {
  if (a.endIndex <= a.startIndex) throw new Error('endIndex must be greater than startIndex (the range is [startIndex, endIndex), end exclusive)');
  return compact({ startIndex: a.startIndex, endIndex: a.endIndex, tabId });
};
const place = (a: Args) => a.index === undefined ? { endOfSegmentLocation: compact({ tabId: a.tabId }) } : { location: compact({ index: a.index, tabId: a.tabId }) };
const tableStart = (a: Args) => compact({ index: a.tableStartIndex, tabId: a.tabId });
const cells = (a: Args, rowSpan: number, columnSpan: number) => ({ tableCellLocation: { tableStartLocation: tableStart(a), rowIndex: a.rowIndex, columnIndex: a.columnIndex }, rowSpan, columnSpan });

export function docsTools(api = new GoogleApi('https://docs.googleapis.com')): Tool[] {
  const ref = (name: string, run: Tool['run'], risk: 'read' | 'write' | 'destructive' = 'write') => referenceTool('docs', name, run, { risk });
  const path = (id: string) => `/v1/documents/${segment(/\/document\/(?:u\/\d+\/)?d\/([\w-]+)/.exec(id)?.[1] ?? id.trim())}`;
  const get = (id: string) => api.request(path(id), { includeTabsContent: true });
  const batch = async (id: string, requests: any[], requiredRevisionId?: string) => {
    try {
      return await api.request(`${path(id)}:batchUpdate`, {}, 'POST', compact({ requests, writeControl: requiredRevisionId ? { requiredRevisionId } : undefined }));
    } catch (error) {
      if (requiredRevisionId && error instanceof Error && /revision/i.test(error.message))
        throw new Error(`${error.message} The document changed after revision ${requiredRevisionId}; nothing was applied. Re-read it and retry with fresh indexes.`);
      throw error;
    }
  };
  const write = (a: Args, request: any) => batch(a.documentId, [request], a.requiredRevisionId);
  return [
    ref('read_document', async a => {
      const doc = await get(a.documentId), tab = pickTab(doc, a.tabId), max = a.maxChars ?? 100_000, from = a.startIndex ?? 0;
      const elements: any[] = [];
      let used = 0, next: number | undefined;
      for (const el of tab.body) {
        if ((el.endIndex ?? 0) <= from) continue;
        const item = readElement(el, tab.doc);
        if (!item) continue;
        const size = JSON.stringify(item).length;
        if (used + size > max) {
          if (!elements.length) throw new Error(`The element at index ${item.start} needs ${size} characters, more than maxChars ${max}. Raise maxChars (up to 250000).`);
          next = item.start;
          break;
        }
        elements.push(item);
        used += size;
      }
      return compact({ documentId: doc.documentId, title: doc.title, revisionId: doc.revisionId, tab: compact({ tabId: tab.tabId, title: tab.title }), tabs: tabInventory(doc),
        bodyEnd: tab.body.at(-1)?.endIndex, headers: segments(tab.doc, 'header'), footers: segments(tab.doc, 'footer'), elements, truncated: next !== undefined, nextStartIndex: next });
    }, 'read'),
    ref('find_text', async a => {
      const doc = await get(a.documentId), tab = pickTab(doc, a.tabId), all = findText(tab.body, a.text);
      return compact({ documentId: doc.documentId, revisionId: doc.revisionId, tabId: tab.tabId, totalMatches: all.length,
        matches: a.occurrence ? all.slice(a.occurrence - 1, a.occurrence) : all.slice(0, 20), truncated: !a.occurrence && all.length > 20 ? true : undefined });
    }, 'read'),
    ref('create_document', async a => {
      const doc = await api.request('/v1/documents', {}, 'POST', { title: a.title });
      return compact({ documentId: doc.documentId, title: doc.title, revisionId: doc.revisionId, url: doc.documentId ? `https://docs.google.com/document/d/${doc.documentId}/edit` : undefined });
    }),
    ref('insert_text', async a => {
      const text = clean(a.text);
      if (!text) throw new Error('text is empty after removing the control and private-use characters Google Docs strips');
      let at: number = a.index, start: number = a.index, insert = text, tabId: string | undefined = a.tabId, revision: string | undefined = a.requiredRevisionId, bulleted = false;
      const append = a.index === undefined;
      if (append) {
        const doc = await get(a.documentId), tab = pickTab(doc, a.tabId), last = tab.body.at(-1);
        if (!last?.paragraph) throw new Error('Could not find the end of the tab body; re-read the document');
        // An empty final paragraph (a new document, or the line after a table) is filled; otherwise a new paragraph is split off it.
        const empty = last.endIndex - (last.startIndex ?? 0) <= 1;
        at = last.endIndex - 1; start = empty ? at : at + 1; insert = empty ? text : `\n${text}`;
        tabId = tab.tabId; revision ??= doc.revisionId; bulleted = Boolean(last.paragraph.bullet);
      }
      const range = compact({ startIndex: start, endIndex: start + text.length, tabId }), style = compact({ bold: a.bold, italic: a.italic });
      const requests: any[] = [{ insertText: { location: compact({ index: at, tabId }), text: insert } }];
      if (bulleted) requests.push({ deleteParagraphBullets: { range } });
      if (append || a.paragraphStyle) requests.push({ updateParagraphStyle: { range, paragraphStyle: { namedStyleType: a.paragraphStyle ?? 'NORMAL_TEXT' }, fields: append ? plainParagraph : 'namedStyleType' } });
      if (append || Object.keys(style).length) requests.push({ updateTextStyle: { range, textStyle: style, fields: append ? '*' : Object.keys(style).join(',') } });
      const result = await batch(a.documentId, requests, revision);
      return compact({ documentId: result.documentId, tabId, insertedRange: { start, end: start + text.length }, revisionId: result.writeControl?.requiredRevisionId });
    }),
    ref('replace_text', a => write(a, { replaceAllText: compact({ containsText: { text: a.find, matchCase: a.matchCase ?? true }, replaceText: a.replace, tabsCriteria: a.tabIds ? { tabIds: a.tabIds } : undefined }) })),
    ref('delete_content', async a => {
      span(a);
      const doc = await get(a.documentId), tab = pickTab(doc, a.tabId), problem = deleteProblem(tab.body, a.startIndex, a.endIndex);
      if (problem) throw new Error(`Cannot delete [${a.startIndex}, ${a.endIndex}): ${problem}. Nothing was deleted; re-read the document for current ranges.`);
      return batch(a.documentId, [{ deleteContentRange: { range: span(a, tab.tabId) } }], a.requiredRevisionId ?? doc.revisionId);
    }, 'destructive'),
    ref('apply_text_style', a => {
      if (a.fontFamily !== undefined && !a.fontFamily.trim()) throw new Error('fontFamily must not be empty');
      const textStyle = compact({ bold: a.bold, italic: a.italic, underline: a.underline, strikethrough: a.strikethrough, fontSize: a.fontSize === undefined ? undefined : pt(a.fontSize),
        weightedFontFamily: a.fontFamily === undefined ? undefined : { fontFamily: a.fontFamily.trim() }, foregroundColor: color(a.textColor), backgroundColor: color(a.backgroundColor),
        link: a.linkUrl === undefined ? undefined : { url: a.linkUrl } });
      if (!Object.keys(textStyle).length) throw new Error('Give at least one of bold, italic, underline, strikethrough, fontSize, fontFamily, textColor, backgroundColor or linkUrl');
      return write(a, { updateTextStyle: { range: span(a), textStyle, fields: Object.keys(textStyle).join(',') } });
    }),
    ref('apply_paragraph_style', a => write(a, { updateParagraphStyle: { range: span(a), paragraphStyle: { namedStyleType: a.namedStyleType }, fields: 'namedStyleType' } })),
    ref('set_paragraph_format', a => {
      const paragraphStyle = compact({ alignment: a.alignment, indentStart: a.indentStart === undefined ? undefined : pt(a.indentStart), indentEnd: a.indentEnd === undefined ? undefined : pt(a.indentEnd), lineSpacing: a.lineSpacing });
      if (!Object.keys(paragraphStyle).length) throw new Error('Give at least one of alignment, indentStart, indentEnd or lineSpacing');
      return write(a, { updateParagraphStyle: { range: span(a), paragraphStyle, fields: Object.keys(paragraphStyle).join(',') } });
    }),
    ref('create_list', async a => {
      const anchored = a.firstItemText !== undefined || a.lastItemText !== undefined, indexed = a.startIndex !== undefined || a.endIndex !== undefined;
      if (anchored === indexed) throw new Error('Pass exactly one addressing form: firstItemText/lastItemText, or startIndex and endIndex');
      let range: any, revision: string | undefined = a.requiredRevisionId;
      if (anchored) {
        if (a.firstItemText === undefined) throw new Error('lastItemText needs firstItemText');
        const doc = await get(a.documentId), tab = pickTab(doc, a.tabId);
        range = compact({ ...anchorRange(tab.body, a.firstItemText, a.lastItemText), tabId: tab.tabId });
        revision ??= doc.revisionId;
      } else {
        if (a.startIndex === undefined || a.endIndex === undefined) throw new Error('Pass both startIndex and endIndex');
        range = span(a);
      }
      // Stripping membership first makes the list fresh; dropping the indent deleteParagraphBullets adds leaves plain paragraphs.
      const result = await batch(a.documentId, [{ deleteParagraphBullets: { range } }, { updateParagraphStyle: { range, paragraphStyle: {}, fields: 'indentStart,indentFirstLine' } },
        ...(a.remove ? [] : [{ createParagraphBullets: { range, bulletPreset: a.bulletPreset ?? 'BULLET_DISC_CIRCLE_SQUARE' } }])], revision);
      return anchored ? { ...result, range: { start: range.startIndex, end: range.endIndex } } : result;
    }),
    ref('insert_table', a => write(a, { insertTable: { rows: a.rows, columns: a.columns, ...place(a) } })),
    ref('merge_table_cells', a => {
      if (a.rowSpan * a.columnSpan < 2) throw new Error('Merge a block of at least two cells (rowSpan or columnSpan above 1)');
      return write(a, { mergeTableCells: { tableRange: cells(a, a.rowSpan, a.columnSpan) } });
    }),
    ref('set_table_column_width', a => write(a, { updateTableColumnProperties: { tableStartLocation: tableStart(a), columnIndices: [...new Set(a.columnIndices)],
      tableColumnProperties: { widthType: 'FIXED_WIDTH', width: pt(a.widthPt) }, fields: 'widthType,width' } })),
    ref('set_table_cell_shading', a => write(a, { updateTableCellStyle: { tableRange: cells(a, a.rowSpan ?? 1, a.columnSpan ?? 1), tableCellStyle: { backgroundColor: color(a.fillColor) }, fields: 'backgroundColor' } })),
    ref('insert_image', a => {
      if (!/^https?:\/\/[^/\s]/i.test(a.imageUrl)) throw new Error('imageUrl must be a public http(s) URL that Google can fetch without signing in');
      const objectSize = compact({ width: a.width === undefined ? undefined : pt(a.width), height: a.height === undefined ? undefined : pt(a.height) });
      return write(a, { insertInlineImage: compact({ uri: a.imageUrl, ...place(a), objectSize: Object.keys(objectSize).length ? objectSize : undefined }) });
    }),
    ref('insert_page_break', a => write(a, { insertPageBreak: { location: compact({ index: a.index, tabId: a.tabId }) } })),
    ref('set_header_footer', async a => {
      const doc = await get(a.documentId), tab = pickTab(doc), kind: 'header' | 'footer' = a.kind, K = kind === 'header' ? 'Header' : 'Footer', text = clean(a.text);
      let id: string | undefined = tab.doc.documentStyle?.[`default${K}Id`], revision: string | undefined = a.requiredRevisionId ?? doc.revisionId;
      let content: any[] = id ? tab.doc[`${kind}s`]?.[id]?.content ?? [] : [];
      if (!id) {
        if (!text) return { segmentId: null, revisionId: doc.revisionId };
        // The new segment's id is only known from the reply, so its text needs a second, revision-chained write.
        const created = await batch(a.documentId, [{ [`create${K}`]: { type: 'DEFAULT' } }], revision);
        id = created.replies?.[0]?.[`create${K}`]?.[`${kind}Id`];
        if (!id) throw new Error(`Google did not return the new ${kind} id`);
        revision = created.writeControl?.requiredRevisionId;
        content = [];
      }
      const first = content[0]?.startIndex ?? 0, end = content.at(-1)?.endIndex ?? first + 1, requests: any[] = [];
      if (end - 1 > first) requests.push({ deleteContentRange: { range: { segmentId: id, startIndex: first, endIndex: end - 1 } } });
      if (text) requests.push({ insertText: { location: { segmentId: id, index: first }, text } });
      if (!requests.length) return { segmentId: id, revisionId: doc.revisionId };
      const result = await batch(a.documentId, requests, revision);
      return { segmentId: id, revisionId: result.writeControl?.requiredRevisionId ?? null };
    }),
  ];
}
if (import.meta.main) await servePlugin('openteam-google-docs', docsTools());
