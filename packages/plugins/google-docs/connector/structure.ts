import { compact } from '../../_shared/reference';

// Docs indexes count UTF-16 code units, like JS string length. Non-text inline elements (images, chips,
// page breaks, footnote references) occupy index positions but carry no text; they read as U+FFFC so
// every code unit of a paragraph's text still maps to exactly one document index.
export const OBJECT = '￼';
export type Tab = { tabId?: string; title?: string; body: any[]; doc: any };

const allTabs = (tabs: any[] = [], out: any[] = []): any[] => { for (const t of tabs) { out.push(t); allTabs(t.childTabs, out); } return out; };
export const tabInventory = (doc: any) => allTabs(doc.tabs).map(t => compact({ tabId: t.tabProperties?.tabId, title: t.tabProperties?.title, parentTabId: t.tabProperties?.parentTabId, nestingLevel: t.tabProperties?.nestingLevel || undefined }));
export function pickTab(doc: any, tabId?: string): Tab {
  const tabs = allTabs(doc.tabs);
  if (!tabs.length && !tabId) return { title: doc.title, body: doc.body?.content ?? [], doc };
  const tab = tabId ? tabs.find(t => t.tabProperties?.tabId === tabId) : tabs[0];
  if (!tab) throw new Error(`Tab ${tabId} was not found. Available tabs: ${tabs.map(t => `${t.tabProperties?.tabId} (${t.tabProperties?.title})`).join(', ') || 'none'}`);
  return { tabId: tab.tabProperties?.tabId, title: tab.tabProperties?.title, body: tab.documentTab?.body?.content ?? [], doc: tab.documentTab ?? {} };
}

const start = (e: any): number => e.startIndex ?? 0;
export const elementText = (e: any): string => e.textRun ? e.textRun.content ?? '' : OBJECT.repeat(Math.max(0, (e.endIndex ?? 0) - start(e)));
export const paragraphText = (p: any) => (p.elements ?? []).map(elementText).join('').replace(/\n$/, '');
const listText = (p: any) => (p.bullet ? '• ' : '') + paragraphText(p);
export const contentText = (content: any[]): string => content.map(e => e.paragraph ? listText(e.paragraph)
  : e.table ? (e.table.tableRows ?? []).map((r: any) => (r.tableCells ?? []).map((c: any) => contentText(c.content ?? []).replaceAll('\n', ' ')).join(' | ')).join('\n')
  : e.tableOfContents ? contentText(e.tableOfContents.content ?? []) : undefined).filter(t => t !== undefined).join('\n');

export const rgb = (hex: string) => ({ red: parseInt(hex.slice(1, 3), 16) / 255, green: parseInt(hex.slice(3, 5), 16) / 255, blue: parseInt(hex.slice(5, 7), 16) / 255 });
const hex = (c: any) => {
  const v = c?.color?.rgbColor;
  return v ? `#${[v.red, v.green, v.blue].map((n: number | undefined) => Math.round((n ?? 0) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}` : undefined;
};
const link = (l: any) => l && (l.url ?? (l.headingId ? `#heading=${l.headingId}` : l.bookmarkId ? `#bookmark=${l.bookmarkId}` : l.tabId ? `#tab=${l.tabId}` : undefined));
// Same names as apply_text_style inputs, so a read can confirm a styling call.
const textStyle = (s: any = {}) => compact({ bold: s.bold, italic: s.italic, underline: s.underline, strikethrough: s.strikethrough, smallCaps: s.smallCaps,
  baselineOffset: s.baselineOffset && s.baselineOffset !== 'NONE' ? s.baselineOffset : undefined, fontSize: s.fontSize?.magnitude,
  fontFamily: s.weightedFontFamily?.fontFamily, textColor: hex(s.foregroundColor), backgroundColor: hex(s.backgroundColor), linkUrl: link(s.link) });
const ordered = new Set(['DECIMAL', 'ZERO_DECIMAL', 'UPPER_ALPHA', 'ALPHA', 'UPPER_ROMAN', 'ROMAN']);

function inlineObject(e: any, ctx: any) {
  const base = { start: start(e), end: e.endIndex };
  if (e.inlineObjectElement) {
    const object = ctx.inlineObjects?.[e.inlineObjectElement.inlineObjectId]?.inlineObjectProperties?.embeddedObject;
    return compact({ ...base, type: 'image', objectId: e.inlineObjectElement.inlineObjectId, title: object?.title, description: object?.description, width: object?.size?.width?.magnitude, height: object?.size?.height?.magnitude });
  }
  if (e.person) return compact({ ...base, type: 'person', name: e.person.personProperties?.name, email: e.person.personProperties?.email });
  if (e.richLink) return compact({ ...base, type: 'richLink', title: e.richLink.richLinkProperties?.title, url: e.richLink.richLinkProperties?.uri });
  if (e.footnoteReference) return compact({ ...base, type: 'footnoteReference', number: e.footnoteReference.footnoteNumber });
  if (e.autoText) return compact({ ...base, type: 'autoText', kind: e.autoText.type });
  return { ...base, type: Object.keys(e).find(k => k !== 'startIndex' && k !== 'endIndex') ?? 'unknown' };
}

function paragraph(el: any, ctx: any) {
  const p = el.paragraph, ps = p.paragraphStyle ?? {}, bullet = p.bullet, level = bullet?.nestingLevel ?? 0;
  const spans: any[] = [], objects: any[] = [];
  for (const e of p.elements ?? []) {
    if (!e.textRun) { objects.push(inlineObject(e, ctx)); continue; }
    const style = textStyle(e.textRun.textStyle), end = e.endIndex - (e.textRun.content?.endsWith('\n') ? 1 : 0), key = JSON.stringify(style);
    if (key === '{}' || end <= start(e)) continue;
    const previous = spans.at(-1);
    if (previous && previous.end === start(e) && previous.key === key) previous.end = end;
    else spans.push({ start: start(e), end, key, style });
  }
  const glyph = bullet ? ctx.lists?.[bullet.listId]?.listProperties?.nestingLevels?.[level]?.glyphType : undefined;
  const format = compact({ alignment: ps.alignment && ps.alignment !== 'START' ? ps.alignment : undefined, indentStart: ps.indentStart?.magnitude || undefined,
    indentEnd: ps.indentEnd?.magnitude || undefined, lineSpacing: ps.lineSpacing && ps.lineSpacing !== 100 ? ps.lineSpacing : undefined });
  return compact({
    start: start(el), end: el.endIndex,
    style: ps.namedStyleType && ps.namedStyleType !== 'NORMAL_TEXT' ? ps.namedStyleType : undefined,
    text: listText(p),
    list: bullet ? compact({ listId: bullet.listId, level: level || undefined, numbered: ordered.has(glyph) || undefined }) : undefined,
    format: Object.keys(format).length ? format : undefined,
    spans: spans.length ? spans.map(s => ({ start: s.start, end: s.end, ...s.style })) : undefined,
    objects: objects.length ? objects : undefined,
  });
}

function table(el: any) {
  const cells: any[] = [];
  (el.table.tableRows ?? []).forEach((row: any, r: number) => (row.tableCells ?? []).forEach((cell: any, c: number) => {
    const content = cell.content ?? [], st = cell.tableCellStyle ?? {};
    // Content range, not the cell marker: insert_text at `start` lands in the cell's first paragraph.
    cells.push(compact({ row: r, column: c, start: content[0] ? start(content[0]) : start(cell) + 1, end: content.at(-1)?.endIndex ?? cell.endIndex, text: contentText(content),
      rowSpan: st.rowSpan > 1 ? st.rowSpan : undefined, columnSpan: st.columnSpan > 1 ? st.columnSpan : undefined, fillColor: hex(st.backgroundColor) }));
  }));
  return { start: start(el), end: el.endIndex, table: `${el.table.rows}x${el.table.columns}`, cells };
}

export function readElement(el: any, ctx: any) {
  if (el.paragraph) return paragraph(el, ctx);
  if (el.table) return table(el);
  if (el.tableOfContents) return { start: start(el), end: el.endIndex, tableOfContents: true, text: contentText(el.tableOfContents.content ?? []) };
  if (el.sectionBreak && start(el) > 0) return { start: start(el), end: el.endIndex, sectionBreak: true };
  return undefined;
}

export function segments(ctx: any, kind: 'header' | 'footer') {
  const K = kind === 'header' ? 'Header' : 'Footer', ds = ctx.documentStyle ?? {};
  const type = (id: string) => id === ds[`default${K}Id`] ? 'default' : id === ds[`firstPage${K}Id`] ? 'firstPage' : id === ds[`evenPage${K}Id`] ? 'evenPage' : undefined;
  const list = Object.entries(ctx[`${kind}s`] ?? {}).map(([id, s]: [string, any]) => compact({ id, type: type(id), text: contentText(s.content ?? []) }));
  return list.length ? list : undefined;
}

export type Para = { start: number; end: number; text: string; container: string; el: any };
export function paragraphs(content: any[], container = 'body', out: Para[] = []): Para[] {
  for (const el of content) {
    if (el.paragraph) out.push({ start: start(el), end: el.endIndex, text: paragraphText(el.paragraph), container, el });
    else if (el.table) for (const row of el.table.tableRows ?? []) for (const cell of row.tableCells ?? []) paragraphs(cell.content ?? [], `table cell at ${start(cell)}`, out);
  }
  return out;
}

export function findText(content: any[], text: string) {
  const paras = paragraphs(content), pos: number[] = [], owner: number[] = [];
  let flat = '';
  paras.forEach((p, i) => {
    for (const e of p.el.paragraph.elements ?? []) {
      const s = elementText(e);
      // A gap (table or cell structure) between runs must never be matched across.
      if (pos.length && pos.at(-1)! + 1 !== start(e)) { flat += '\u0000'; pos.push(-1); owner.push(-1); }
      for (let k = 0; k < s.length; k++) { pos.push(start(e) + k); owner.push(i); }
      flat += s;
    }
  });
  const matches: any[] = [];
  for (let at = flat.indexOf(text); at >= 0; at = flat.indexOf(text, at + text.length)) {
    const p = paras[owner[at]!]!;
    matches.push({ start: pos[at]!, end: pos[at + text.length - 1]! + 1, paragraph_start: p.start, paragraph_end: p.end, paragraph_text: p.text });
  }
  return matches;
}

export function anchorRange(content: any[], first: string, last?: string) {
  const paras = paragraphs(content).filter(p => p.text);
  const leads = (p: Para, anchor: string) => [anchor, anchor.replace(/^•\s*/, '')].some(t => t && (p.text.startsWith(t) || p.text.replace(/^\t+/, '').startsWith(t)));
  const firsts = paras.filter(p => leads(p, first));
  if (!firsts.length) throw new Error(`No paragraph starts with firstItemText ${JSON.stringify(first)}. Check the text with read_document or find_text.`);
  if (firsts.length > 1) throw new Error(`firstItemText ${JSON.stringify(first)} starts ${firsts.length} paragraphs (at ${firsts.slice(0, 5).map(p => p.start).join(', ')}). Give more of its leading text, or pass startIndex/endIndex from a fresh read_document.`);
  const head = firsts[0]!, from = paras.indexOf(head);
  const tail = last === undefined ? head : paras.slice(from + 1).find(p => p.container === head.container && leads(p, last)) ?? (leads(head, last) ? head : undefined);
  if (!tail) throw new Error(`No paragraph after ${JSON.stringify(first)} in the same ${head.container} starts with lastItemText ${JSON.stringify(last)}.`);
  // Stop before the last item's newline: the range still overlaps it and never touches a segment's final newline.
  return { startIndex: head.start, endIndex: tail.end - 1 };
}

const high = (c: number) => c >= 0xd800 && c <= 0xdbff, low = (c: number) => c >= 0xdc00 && c <= 0xdfff;
/** Mirrors the Docs API's invalid-deletion rules so a rejected range gets a specific explanation. */
export function deleteProblem(content: any[], from: number, to: number, segment = 'tab body'): string | undefined {
  const last = content.at(-1)?.endIndex ?? 0;
  if (to >= last) return to > last ? `it ends past the end of the ${segment} (${last})` : `it includes the final newline of the ${segment} at ${last - 1}, which cannot be deleted; end at ${last - 1}`;
  for (const [i, el] of content.entries()) {
    const s = start(el), e = el.endIndex;
    if (to <= s || from >= e) continue;
    const whole = from <= s && to >= e;
    if (el.paragraph) {
      for (const pe of el.paragraph.elements ?? []) {
        if (pe.equation && from < pe.endIndex && to > start(pe) && !(from <= start(pe) && to >= pe.endIndex)) return `it covers part of the equation at ${start(pe)}`;
        const text: string | undefined = pe.textRun?.content;
        if (text) for (const b of [from, to]) {
          const o = b - start(pe);
          if (o > 0 && o < text.length && high(text.charCodeAt(o - 1)) && low(text.charCodeAt(o))) return `index ${b} splits a surrogate pair (an emoji or other character that takes two index positions); move it by one`;
        }
      }
      const next = content[i + 1], kind = next?.table ? 'table' : next?.tableOfContents ? 'table of contents' : next?.sectionBreak ? 'section break' : undefined;
      if (kind && from <= e - 1 && to >= e && to < next.endIndex) return `it deletes the newline before the ${kind} at ${e} without deleting the whole ${kind}`;
    } else if (el.table && !whole) {
      for (const row of el.table.tableRows ?? []) for (const cell of row.tableCells ?? []) {
        const c = cell.content ?? [];
        if (from >= (c[0] ? start(c[0]) : start(cell) + 1) && to <= (c.at(-1)?.endIndex ?? cell.endIndex)) return deleteProblem(c, from, to, 'table cell');
      }
      return `it splits the table at ${s} (part of a row or a cell boundary); delete text inside one cell, or the whole table [${s}, ${e})`;
    } else if (el.tableOfContents && !whole) return `it covers part of the table of contents at ${s}; delete the whole element [${s}, ${e})`;
  }
  return undefined;
}
