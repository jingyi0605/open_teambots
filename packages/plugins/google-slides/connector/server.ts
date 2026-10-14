import { GoogleApi, segment, servePlugin, ToolContent, type Args, type Tool } from '../../_shared/google';
import { compact, referenceTool, referenceTools } from '../../_shared/reference';
import { checkPair, onColor, solidFill } from './contrast';
import { apply, dim, EMU, findElement, flatten, identity, pageSize, placement, round, roundBox, toAffine, type Box, type Flat } from './geometry';
import { compileHtml } from './html';
import { formatTree, plainText, slideLayout } from './inspect';
import { composePlan, DEFAULTS, edges, gridPlacement, planElements, planRequests, planView, resolveTheme, type LayoutNode } from './layout';
import { lint, type LintElement } from './lint';
import { createShape, defined, insertText, newId, pageBackground, paragraphStyle, shapeStyle, textStyle } from './requests';
import { INSET, measure, paragraphsOf } from './text';

type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
const THUMBNAIL_MAX_BYTES = 25 * 1024 * 1024;
const NO_SLIDE = { width: 1e9, height: 1e9 };
// ECMA-376 connection sites as fractions of the shape box: rect-like presets list top, left, bottom, right.
const SITES: Record<string, Array<[number, number]>> = {
  RECT: [[0.5, 0], [0, 0.5], [0.5, 1], [1, 0.5]],
  ELLIPSE: [[0.5, 0], [0.1464, 0.1464], [0, 0.5], [0.1464, 0.8536], [0.5, 1], [0.8536, 0.8536], [1, 0.5], [0.8536, 0.1464]],
  TRIANGLE: [[0.5, 0], [0.25, 0.5], [0, 1], [0.5, 1], [1, 1], [0.75, 0.5]],
};
const kindOf = (e: any) => e.shape ? 'shape' : e.table ? 'table' : e.image ? 'image' : e.line ? 'line' : e.elementGroup ? 'group' : e.video ? 'video' : e.sheetsChart ? 'chart' : 'element';

export function slidesTools(api = new GoogleApi('https://slides.googleapis.com'), fetchImage: Fetch = fetch): Tool[] {
  // Risk follows the pinned readOnlyHint: reads stay 'read', deletes are 'destructive', everything else 'write'.
  const ref = (name: string, run: Tool['run'], options: Parameters<typeof referenceTool>[3] = {}) => referenceTool('slides', name, run, { risk: referenceTools.slides.find(t => t.name === name)?.annotations.readOnlyHint ? 'read' : 'write', ...options });
  const pres = (id: string) => `/v1/presentations/${segment(id)}`;
  const getPage = (a: Args) => api.request(`${pres(a.presentationId)}/pages/${segment(a.pageObjectId)}`);
  const batch = async (a: Args, requests: unknown[], revision: string | undefined = a.requiredRevisionId) => {
    try {
      return await api.request(`${pres(a.presentationId)}:batchUpdate`, {}, 'POST', compact({ requests, writeControl: revision ? { requiredRevisionId: revision } : undefined }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (revision && /revision/i.test(message)) throw new Error(`${message} The presentation changed since revision ${revision}, so nothing was applied; read it again and retry with the new revisionId.`);
      throw error;
    }
  };
  const revisionOf = (result: any) => result?.writeControl?.requiredRevisionId ?? null;
  const onPage = (page: any, objectId: string, what = 'object') => {
    const found = findElement(page.pageElements, objectId);
    if (!found) throw new Error(`${what} ${objectId} is not on page ${page.objectId}; use read_presentation for objectIds`);
    return found;
  };
  /** A straight segment as line element properties (EMU so a horizontal or vertical line keeps a 1 EMU thickness). */
  const segmentProps = (pageObjectId: string, x1: number, y1: number, x2: number, y2: number) => {
    if (Math.abs(x2 - x1) < 0.01 && Math.abs(y2 - y1) < 0.01) throw new Error('The line starts and ends at the same point');
    return {
      pageObjectId,
      size: { width: { magnitude: Math.max(1, Math.round(Math.abs(x2 - x1) * EMU)), unit: 'EMU' }, height: { magnitude: Math.max(1, Math.round(Math.abs(y2 - y1) * EMU)), unit: 'EMU' } },
      transform: { scaleX: x2 < x1 ? -1 : 1, scaleY: y2 < y1 ? -1 : 1, translateX: Math.round(x1 * EMU), translateY: Math.round(y1 * EMU), unit: 'EMU' },
    };
  };
  const lineStyle = (objectId: string, a: Args, extra: Record<string, unknown> = {}) => {
    const lineProperties: Record<string, unknown> = { ...extra, weight: { magnitude: a.weightPt ?? 1, unit: 'PT' } };
    if (a.color) lineProperties.lineFill = solidFill(a.color);
    if (a.startArrow) lineProperties.startArrow = a.startArrow;
    if (a.endArrow) lineProperties.endArrow = a.endArrow;
    return { updateLineProperties: { objectId, lineProperties, fields: Object.keys(lineProperties).join(',') } };
  };
  const sites = (f: Flat) => {
    const e = f.element, w = dim(e.size?.width), h = dim(e.size?.height);
    const table = SITES[e.shape?.shapeType === 'ELLIPSE' ? 'ELLIPSE' : e.shape?.shapeType === 'TRIANGLE' ? 'TRIANGLE' : 'RECT']!;
    return table.map(([fx, fy], index) => ({ index, point: apply(f.matrix, fx * w, fy * h) }));
  };
  const element = (e: any, nested = false): any => {
    const extra = e.title ? { title: e.title } : {};
    if (e.shape) return compact({ objectId: e.objectId, kind: 'shape', shapeType: e.shape.shapeType, placeholder: e.shape.placeholder?.type, text: plainText(e.shape.text), ...extra });
    if (e.table) return { objectId: e.objectId, kind: 'table', size: `${e.table.rows}x${e.table.columns}`, cells: (e.table.tableRows ?? []).flatMap((row: any, r: number) => (row.tableCells ?? []).map((cell: any, c: number) => ({ row: cell.location?.rowIndex ?? r, column: cell.location?.columnIndex ?? c, text: plainText(cell.text) }))).filter((cell: any) => cell.text), ...extra };
    if (e.image) return { objectId: e.objectId, kind: 'image', ...extra };
    if (e.elementGroup) return nested ? { objectId: e.objectId, kind: 'group', memberObjectIds: (e.elementGroup.children ?? []).map((c: any) => c.objectId), ...extra } : { objectId: e.objectId, kind: 'group', children: (e.elementGroup.children ?? []).map((c: any) => element(c, true)), ...extra };
    return { objectId: e.objectId, kind: 'other', ...extra };
  };
  const slideEntry = (s: any, index: number, includeNotes: boolean) => {
    const notesPage = s.slideProperties?.notesPage, speaker = notesPage?.notesProperties?.speakerNotesObjectId;
    const notes = includeNotes && notesPage ? { notesPageId: notesPage.objectId, speakerNotesObjectId: speaker, text: plainText((notesPage.pageElements ?? []).find((e: any) => e.objectId === speaker)?.shape?.text) } : undefined;
    return compact({ index, objectId: s.objectId, layoutObjectId: s.slideProperties?.layoutObjectId, skipped: s.slideProperties?.isSkipped ? true : undefined, elements: (s.pageElements ?? []).map((e: any) => element(e)), notes });
  };

  return [
    ref('read_presentation', async a => {
      const deck = await api.request(pres(a.presentationId), { fields: 'presentationId,title,revisionId,pageSize,layouts(objectId,layoutProperties),slides' });
      const slides: any[] = deck.slides ?? [], from = a.fromSlide ?? 0, maxChars = Math.min(a.maxChars ?? 100_000, 250_000), includeNotes = a.includeNotes ?? true;
      const out: any[] = [];
      let used = 0, nextSlide: number | undefined;
      for (let i = from; i < slides.length; i++) {
        const entry = slideEntry(slides[i], i, includeNotes), size = JSON.stringify(entry).length;
        if (used + size > maxChars) {
          if (!out.length) throw new Error(`Slide ${i} alone is ${size} characters, more than maxChars ${maxChars}; ${maxChars < 250_000 ? 'raise maxChars (up to 250000)' : 'read it with read_slide_layout format json, or the whole deck as text with google-drive read_file'}`);
          nextSlide = i; break;
        }
        out.push(entry); used += size;
      }
      return compact({ presentationId: deck.presentationId ?? a.presentationId, title: deck.title, revisionId: deck.revisionId ?? null, pageSize: pageSize(deck), layouts: (deck.layouts ?? []).map((l: any) => compact({ objectId: l.objectId, name: l.layoutProperties?.name, displayName: l.layoutProperties?.displayName })), slideCount: slides.length, fromSlide: from || undefined, slides: out, truncated: nextSlide !== undefined, nextSlide });
    }),

    ref('create_presentation', async a => {
      const deck = await api.request('/v1/presentations', {}, 'POST', { title: a.title });
      const first = deck.slides?.[0];
      return { presentationId: deck.presentationId, title: deck.title ?? a.title, revisionId: deck.revisionId ?? null, firstSlideObjectId: first?.objectId ?? null, placeholders: (first?.pageElements ?? []).filter((e: any) => e.shape?.placeholder).map((e: any) => ({ objectId: e.objectId, type: e.shape.placeholder.type })), pageSize: pageSize(deck), url: `https://docs.google.com/presentation/d/${deck.presentationId}/edit` };
    }),

    ref('add_slide', async a => {
      if (a.layout && a.layoutId) throw new Error('Give either layout or layoutId, not both');
      const deck = await api.request(pres(a.presentationId), { fields: 'revisionId,slides(objectId),layouts(objectId,layoutProperties,pageElements(objectId,shape(placeholder)))' });
      const layouts: any[] = deck.layouts ?? [], count = deck.slides?.length ?? 0, name = a.layout ?? 'TITLE_AND_BODY';
      const available = layouts.map(l => `${l.layoutProperties?.name ?? '?'} (${l.objectId})`).join(', ') || 'none';
      if (a.insertionIndex !== undefined && a.insertionIndex > count) throw new Error(`insertionIndex ${a.insertionIndex} is past the end of this ${count}-slide deck (use 0-${count})`);
      const layout = a.layoutId ? layouts.find(l => l.objectId === a.layoutId) : layouts.find(l => l.layoutProperties?.name === name);
      if (a.layoutId && !layout) throw new Error(`Layout ${a.layoutId} is not in this deck; layouts: ${available}`);
      if ((a.title || a.body) && !layout) throw new Error(`This deck has no ${name} layout to fill; pick a layoutId from read_presentation's layouts: ${available}`);
      const placeholders = (layout?.pageElements ?? []).filter((e: any) => e.shape?.placeholder);
      const slot = (types: string[]) => placeholders.find((e: any) => types.includes(e.shape.placeholder.type));
      const titleSlot = a.title ? slot(['TITLE', 'CENTERED_TITLE']) : undefined, bodySlot = a.body ? slot(['BODY', 'SUBTITLE']) : undefined;
      const missing = [a.title && !titleSlot && 'title (TITLE or CENTERED_TITLE)', a.body && !bodySlot && 'body (BODY or SUBTITLE)'].filter(Boolean);
      if (missing.length) throw new Error(`Layout ${layout.layoutProperties?.name ?? layout.objectId} has no ${missing.join(' or ')} placeholder; its placeholders: ${placeholders.map((e: any) => e.shape.placeholder.type).join(', ') || 'none'}. Nothing was written.`);
      const slideObjectId = newId('slide'), titleObjectId = titleSlot && newId('title'), bodyObjectId = bodySlot && newId('body');
      const mappings = [titleSlot && { layoutPlaceholderObjectId: titleSlot.objectId, objectId: titleObjectId }, bodySlot && { layoutPlaceholderObjectId: bodySlot.objectId, objectId: bodyObjectId }].filter(Boolean);
      const result = await batch(a, defined([
        { createSlide: compact({ objectId: slideObjectId, insertionIndex: a.insertionIndex, slideLayoutReference: layout ? { layoutId: layout.objectId } : { predefinedLayout: name }, placeholderIdMappings: mappings.length ? mappings : undefined }) },
        titleObjectId && insertText(titleObjectId, a.title), bodyObjectId && insertText(bodyObjectId, a.body),
      ]), a.requiredRevisionId ?? deck.revisionId);
      return compact({ slideObjectId, layoutObjectId: layout?.objectId, titleObjectId, bodyObjectId, revisionId: revisionOf(result) });
    }),

    ref('move_slide', a => batch(a, [{ updateSlidesPosition: { slideObjectIds: [a.slideObjectId], insertionIndex: a.newIndex } }])),

    ref('duplicate_object', async a => {
      const deck = await api.request(pres(a.presentationId), { fields: 'slides(objectId)' });
      const slide = (deck.slides ?? []).some((s: any) => s.objectId === a.objectId), copy = newId('copy');
      // The API places an element's copy exactly on the original; nudge it so both stay visible and selectable.
      return batch(a, [{ duplicateObject: { objectId: a.objectId, objectIds: { [a.objectId]: copy } } }, ...(slide ? [] : [{ updatePageElementTransform: { objectId: copy, applyMode: 'RELATIVE', transform: { scaleX: 1, scaleY: 1, translateX: 10, translateY: 10, unit: 'PT' } } }])]);
    }),

    ref('delete_object', a => batch(a, [{ deleteObject: { objectId: a.objectId } }]), { risk: 'destructive' }),

    ref('set_shape_text', async a => {
      const page = await getPage(a);
      const found = findElement(page.pageElements, a.objectId);
      // The speaker notes shape may not exist until text is first inserted into its id.
      if (!found && page.notesProperties?.speakerNotesObjectId !== a.objectId) throw new Error(`Object ${a.objectId} is not on page ${a.pageObjectId}; use read_presentation for objectIds (a group member is addressed by its own objectId)`);
      const e = found?.element, cell = a.cell && { rowIndex: a.cell.rowIndex ?? a.cell.row, columnIndex: a.cell.columnIndex ?? a.cell.column };
      let current: any;
      if (e?.table) {
        if (cell?.rowIndex === undefined || cell.columnIndex === undefined) throw new Error(`${a.objectId} is a table: give cell {rowIndex, columnIndex} (zero-based)`);
        if (cell.rowIndex >= e.table.rows || cell.columnIndex >= e.table.columns) throw new Error(`Cell [${cell.rowIndex},${cell.columnIndex}] is outside the ${e.table.rows}x${e.table.columns} table`);
        current = (e.table.tableRows?.[cell.rowIndex]?.tableCells ?? []).find((c: any, i: number) => (c.location?.columnIndex ?? i) === cell.columnIndex)?.text;
      } else {
        if (a.cell) throw new Error(`cell is only for tables; ${a.objectId} is a ${e ? kindOf(e) : 'shape'}, so omit cell`);
        if (e && !e.shape) throw new Error(`${a.objectId} is a ${kindOf(e)}, which holds no text; target a shape or table`);
        current = e?.shape?.text;
      }
      const cellLocation = e?.table ? cell : undefined;
      const hasText = (current?.textElements ?? []).map((t: any) => t.textRun?.content ?? t.autoText?.content ?? '').join('').replace(/\n$/, '').length > 0;
      const requests = defined([hasText && { deleteText: compact({ objectId: a.objectId, cellLocation, textRange: { type: 'ALL' } }) }, a.text && insertText(a.objectId, a.text, cellLocation)]);
      if (!requests.length) return { noop: true, revisionId: page.revisionId ?? null };
      return { revisionId: revisionOf(await batch(a, requests, a.requiredRevisionId ?? page.revisionId)) };
    }),

    ref('replace_text', a => batch(a, [{ replaceAllText: compact({ containsText: { text: a.find, matchCase: a.matchCase ?? true }, replaceText: a.replace, pageObjectIds: a.pageObjectIds }) }])),

    ref('insert_text_box', async a => {
      const objectId = newId('text');
      const result = await batch(a, defined([createShape(objectId, 'TEXT_BOX', a.pageObjectId, { x: a.x ?? 50, y: a.y ?? 50, width: a.width ?? 300, height: a.height ?? 200 }), insertText(objectId, a.text), textStyle(objectId, { bold: a.bold, fontSize: a.fontSize, color: a.textColor }), paragraphStyle(objectId, { alignment: a.textAlignment })]));
      return { objectId, revisionId: revisionOf(result) };
    }),

    ref('insert_shape', async a => {
      const objectId = newId('shape');
      const result = await batch(a, defined([
        createShape(objectId, a.shapeType, a.pageObjectId, { x: a.x ?? 50, y: a.y ?? 50, width: a.width ?? 300, height: a.height ?? 200 }), shapeStyle(objectId, { fill: a.fillColor, outline: a.outlineColor }),
        ...(a.text ? [insertText(objectId, a.text), textStyle(objectId, { bold: a.bold, fontSize: a.fontSize, color: a.textColor }), paragraphStyle(objectId, { alignment: a.textAlignment })] : []),
      ]));
      return { objectId, revisionId: revisionOf(result) };
    }),

    ref('insert_line', async a => {
      const objectId = newId('line');
      const result = await batch(a, [{ createLine: { objectId, category: 'STRAIGHT', elementProperties: segmentProps(a.pageObjectId, a.x1, a.y1, a.x2, a.y2) } }, lineStyle(objectId, a)]);
      return { objectId, revisionId: revisionOf(result) };
    }),

    ref('connect_shapes', async a => {
      if (a.startObjectId === a.endObjectId) throw new Error('startObjectId and endObjectId must be two different shapes');
      const page = await getPage(a);
      const [start, end] = [a.startObjectId, a.endObjectId].map(id => {
        const found = findElement(page.pageElements, id);
        if (!found) throw new Error(`${id} is not on slide ${a.pageObjectId}; both shapes must be on that slide`);
        if (found.element.elementGroup || found.element.line) throw new Error(`${id} is a ${kindOf(found.element)}; connect shapes, images or tables`);
        return found;
      }) as [Flat, Flat];
      let best = { distance: Infinity, from: sites(start)[0]!, to: sites(end)[0]! };
      for (const from of sites(start)) for (const to of sites(end)) { const distance = Math.hypot(from.point[0] - to.point[0], from.point[1] - to.point[1]); if (distance < best.distance) best = { distance, from, to }; }
      const objectId = newId('connector');
      const [x1, y1] = best.from.point, [x2, y2] = best.to.point;
      const result = await batch(a, [
        { createLine: { objectId, category: a.category ?? 'BENT', elementProperties: segmentProps(a.pageObjectId, x1, y1, x2 === x1 && y2 === y1 ? x2 + 0.5 : x2, y2) } },
        lineStyle(objectId, { ...a, endArrow: a.endArrow || 'FILL_ARROW' }, { startConnection: { connectedObjectId: a.startObjectId, connectionSiteIndex: best.from.index }, endConnection: { connectedObjectId: a.endObjectId, connectionSiteIndex: best.to.index } }),
      ], a.requiredRevisionId ?? page.revisionId);
      return { objectId, startConnectionSite: best.from.index, endConnectionSite: best.to.index, revisionId: revisionOf(result) };
    }),

    ref('insert_image', async a => {
      const x = a.x ?? 50, y = a.y ?? 50;
      const slide = a.maxWidth === undefined || a.maxHeight === undefined ? pageSize(await api.request(pres(a.presentationId), { fields: 'pageSize' })) : undefined;
      // Default box: to the slide's right/bottom margin, mirroring the left/top offset up to 50 pt.
      const width = a.maxWidth ?? slide!.width - x - Math.min(x, 50), height = a.maxHeight ?? slide!.height - y - Math.min(y, 50);
      if (width < 10 || height < 10) throw new Error(`x ${x}, y ${y} leave no room for the image on the ${slide?.width}x${slide?.height} pt slide; pass maxWidth/maxHeight or move it`);
      const objectId = newId('image');
      // Slides scales the image to fit this box and centers it, keeping its aspect ratio.
      const result = await batch(a, [{ createImage: { objectId, url: a.imageUrl, elementProperties: placement(a.pageObjectId, { x, y, width, height }) } }]);
      let fitted: Box | undefined;
      try { fitted = findElement((await getPage(a)).pageElements, objectId)?.box; } catch {}
      return fitted ? { objectId, ...roundBox(fitted), revisionId: revisionOf(result) } : { objectId, x, y, width, height, fitted: false, note: 'The read-back failed; the image is aspect-fitted and centered inside this box.', revisionId: revisionOf(result) };
    }),

    ref('insert_table', async a => {
      const objectId = newId('table');
      const result = await batch(a, [{ createTable: { objectId, rows: a.rows, columns: a.columns, elementProperties: placement(a.pageObjectId, { x: a.x ?? 50, y: a.y ?? 50, width: a.width ?? 300, height: a.height ?? 200 }) } }]);
      return { objectId, rows: a.rows, columns: a.columns, revisionId: revisionOf(result) };
    }),

    ref('set_text_style', a => {
      if ((a.cellRow === undefined) !== (a.cellColumn === undefined)) throw new Error('Give both cellRow and cellColumn for a table cell, or neither for a shape');
      const request = textStyle(a.objectId, { bold: a.bold, italic: a.italic, underline: a.underline, strikethrough: a.strikethrough, fontSize: a.fontSize, fontFamily: a.fontFamily, color: a.textColor }, { type: 'ALL' }, a.cellRow === undefined ? undefined : { rowIndex: a.cellRow, columnIndex: a.cellColumn });
      if (!request) throw new Error('Give at least one of bold, italic, underline, strikethrough, fontSize, fontFamily or textColor');
      return batch(a, [request]);
    }),

    ref('set_table_cell_fill', a => batch(a, [{ updateTableCellProperties: { objectId: a.objectId, tableRange: { location: { rowIndex: a.rowIndex, columnIndex: a.columnIndex }, rowSpan: a.rowSpan ?? 1, columnSpan: a.columnSpan ?? 1 }, tableCellProperties: { tableCellBackgroundFill: solidFill(a.fillColor) }, fields: 'tableCellBackgroundFill.solidFill.color' } }])),

    ref('update_element_position', async a => {
      const page = await getPage(a), found = onPage(page, a.objectId, 'Element');
      const t = toAffine(found.element.transform), p = found.parent ?? identity, det = p[0] * p[3] - p[2] * p[1];
      const dx = a.x - found.box.x, dy = a.y - found.box.y;
      // Move the absolute box; inside a group the delta is expressed in the group's coordinate space.
      const [lx, ly] = det ? [(p[3] * dx - p[2] * dy) / det, (p[0] * dy - p[1] * dx) / det] : [dx, dy];
      const transform = { scaleX: t[0], scaleY: t[3], shearX: t[2], shearY: t[1], translateX: round((t[4] + lx) * EMU, 2), translateY: round((t[5] + ly) * EMU, 2), unit: 'EMU' };
      return batch(a, [{ updatePageElementTransform: { objectId: a.objectId, applyMode: 'ABSOLUTE', transform } }], a.requiredRevisionId ?? page.revisionId);
    }),

    ref('set_slide_background', a => batch(a, [pageBackground(a.pageObjectId, a.color)])),

    ref('get_slide_thumbnail', async a => {
      const thumb = await api.request(`${pres(a.presentationId)}/pages/${segment(a.pageObjectId)}/thumbnail`, { 'thumbnailProperties.thumbnailSize': a.size ?? 'MEDIUM', 'thumbnailProperties.mimeType': 'PNG' });
      const trusted = (value: string) => { try { const u = new URL(value); return u.protocol === 'https:' && /(^|\.)googleusercontent\.com$/.test(u.hostname) ? u : undefined; } catch {} };
      const url = trusted(String(thumb.contentUrl ?? ''));
      if (!url) throw new Error('Google returned an unexpected thumbnail URL');
      // contentUrl is a short-lived public link; the OAuth token is never sent to it.
      const response = await fetchImage(url, { redirect: 'follow', signal: AbortSignal.timeout(30_000) });
      if (response.url && !trusted(response.url)) throw new Error('The thumbnail redirected to an unexpected host');
      if (!response.ok) throw new Error(`Thumbnail download failed: HTTP ${response.status}; try again (the link is short-lived)`);
      const type = response.headers.get('content-type') ?? 'image/png';
      if (!type.startsWith('image/')) throw new Error(`Thumbnail download returned ${type}, not an image`);
      const chunks: Uint8Array[] = []; let size = 0;
      const reader = response.body?.getReader();
      while (reader) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > THUMBNAIL_MAX_BYTES) { await reader.cancel(); throw new Error(`Thumbnail exceeds ${THUMBNAIL_MAX_BYTES} bytes; request a smaller size`); }
        chunks.push(next.value);
      }
      if (!size) throw new Error('Thumbnail download returned no data');
      return new ToolContent([{ type: 'image', data: Buffer.concat(chunks).toString('base64'), mimeType: type.split(';')[0]!.trim() }, { type: 'text', text: JSON.stringify({ pageObjectId: a.pageObjectId, width: thumb.width, height: thumb.height }) }]);
    }),

    ref('check_contrast', async a => ({ results: a.pairs.map(checkPair) })),

    ref('read_slide_layout', async a => {
      const page = await getPage(a);
      const deck = await api.request(pres(a.presentationId), { fields: 'revisionId,pageSize,layouts(objectId,pageElements),masters(objectId,pageElements)' });
      const parents = new Map<string, any>();
      for (const p of [...(deck.layouts ?? []), ...(deck.masters ?? [])]) for (const f of flatten(p.pageElements)) parents.set(f.element.objectId, f.element);
      const layout = slideLayout(page, pageSize(deck), parents, page.revisionId ?? deck.revisionId);
      if ((a.format ?? 'tree') === 'tree') return new ToolContent([{ type: 'text', text: formatTree(layout) }]);
      return { presentationId: a.presentationId, pageObjectId: layout.pageObjectId ?? a.pageObjectId, revisionId: layout.revisionId, slide: layout.slide, background: layout.background, elements: layout.view(), issues: layout.issues };
    }),

    ref('compose_slide', async a => {
      if (Boolean(a.root) === Boolean(a.html)) throw new Error('Give exactly one of root (a layout tree) or html');
      const compiled = a.html ? compileHtml(a.html) : { root: a.root as LayoutNode, background: undefined, padding: undefined };
      const deck = await api.request(pres(a.presentationId), { fields: 'revisionId,pageSize,slides(objectId,pageElements(objectId))' });
      const target = (deck.slides ?? []).find((s: any) => s.objectId === a.pageObjectId);
      if (!target) throw new Error(`Slide ${a.pageObjectId} is not in this presentation; use read_presentation for slide objectIds (or add_slide layout BLANK)`);
      const slide = pageSize(deck), theme = resolveTheme(a.theme, compiled.background);
      const plan = composePlan(compiled.root, slide, compiled.padding ?? edges(a.margin, DEFAULTS.margin), theme, kind => newId(kind));
      const issues = lint(planElements(plan.placed), slide, theme.palette.background, 'plan');
      const requests = [...(a.clear ? (target.pageElements ?? []).map((e: any) => ({ deleteObject: { objectId: e.objectId } })) : []), pageBackground(a.pageObjectId, theme.palette.background), ...planRequests(a.pageObjectId, plan.placed, theme)];
      const result = await batch(a, requests, a.requiredRevisionId ?? (a.clear ? deck.revisionId : undefined));
      return { presentationId: a.presentationId, pageObjectId: a.pageObjectId, revisionId: revisionOf(result), slide, rootBox: roundBox(plan.rootBox), background: theme.palette.background, palette: theme.palette, ...(a.clear ? { deleted: (target.pageElements ?? []).map((e: any) => e.objectId) } : {}), elements: planView(plan.placed), issues };
    }),

    ref('insert_grid', async a => {
      const region = { x: a.x ?? 40, y: a.y ?? 130, width: a.width ?? 640, height: a.height ?? 235 }, gutter = a.gutter ?? 16, columns = a.columns;
      const { placements, rows } = gridPlacement(a.cells, columns, a.rows);
      const cw = (region.width - gutter * (columns - 1)) / columns, rh = (region.height - gutter * (rows - 1)) / rows;
      if (cw < 4 || rh < 4) throw new Error(`A ${rows}x${columns} grid with ${gutter} pt gutters leaves ${round(cw)}x${round(rh)} pt cells in the ${region.width}x${region.height} region; enlarge it or reduce gutter/columns/rows`);
      const requests: unknown[] = [], elements: any[] = [], lintable: LintElement[] = [];
      a.cells.forEach((cell: any, index: number) => {
        const p = placements[index]!, kind = cell.kind ?? (cell.imageUrl ? 'image' : cell.fillColor ? 'card' : 'text'), objectId = newId(kind);
        const box = { x: region.x + p.column * (cw + gutter), y: region.y + p.row * (rh + gutter), width: p.colSpan * cw + (p.colSpan - 1) * gutter, height: p.rowSpan * rh + (p.rowSpan - 1) * gutter };
        if (kind === 'image') {
          if (!cell.imageUrl) throw new Error(`Cell ${index} is an image cell without imageUrl`);
          requests.push({ createImage: { objectId, url: cell.imageUrl, elementProperties: placement(a.pageObjectId, box) } });
          lintable.push({ objectId, kind: 'image', z: index, box, fill: 'image' });
        } else {
          const card = kind === 'card', headline = cell.text ?? '', sub = cell.subtext ?? '';
          if (!card && !headline && !sub) throw new Error(`Cell ${index} needs text, subtext, imageUrl or fillColor`);
          const fill = card ? cell.fillColor ?? '#F1F3F4' : cell.fillColor, color = cell.textColor ?? (fill ? onColor(fill) : undefined);
          const size = cell.fontSize ?? (card ? 28 : 16), bold = cell.bold ?? card, subSize = cell.subtextSize ?? 14, subColor = cell.subtextColor ?? color;
          const content = headline && sub ? `${headline}\n${sub}` : headline || sub;
          requests.push(...defined([createShape(objectId, card ? cell.shapeType ?? 'ROUND_RECTANGLE' : 'TEXT_BOX', a.pageObjectId, box), shapeStyle(objectId, { fill, outline: cell.outlineColor ?? (card ? null : undefined), contentAlignment: card ? 'MIDDLE' : undefined })]));
          if (content) requests.push(...defined([
            insertText(objectId, content),
            headline ? textStyle(objectId, { fontSize: size, bold, color }) : textStyle(objectId, { fontSize: subSize, bold: false, color: subColor }),
            paragraphStyle(objectId, { alignment: cell.textAlignment ?? (card ? 'CENTER' : 'START') }),
            headline && sub && textStyle(objectId, { fontSize: subSize, bold: false, color: subColor }, { type: 'FIXED_RANGE', startIndex: headline.length + 1, endIndex: content.length }),
          ]));
          const paragraphs = [...(headline ? paragraphsOf(headline, size, bold) : []), ...(sub ? paragraphsOf(sub, subSize) : [])];
          const m = measure(paragraphs, box.width), height = m.height + 2 * INSET;
          lintable.push({ objectId, kind: card ? 'shape' : 'text', z: index, box, fill: fill ?? 'none', text: content, styles: [...(headline ? [{ color: color ?? 'theme', size, bold }] : []), ...(sub ? [{ color: subColor ?? 'theme', size: subSize, bold: false }] : [])], ...(content ? { textFit: { lines: m.lines, height: round(height), boxHeight: round(box.height), fits: height <= box.height + 0.5 } } : {}) });
        }
        elements.push(compact({ index, objectId, kind, row: p.row, column: p.column, colSpan: p.colSpan > 1 ? p.colSpan : undefined, rowSpan: p.rowSpan > 1 ? p.rowSpan : undefined, box: roundBox(box) }));
      });
      const result = await batch(a, requests);
      return { presentationId: a.presentationId, pageObjectId: a.pageObjectId, revisionId: revisionOf(result), region, columns, rows, elements, issues: lint(lintable, NO_SLIDE, 'inherited', 'plan') };
    }),
  ];
}
if (import.meta.main) await servePlugin('openteam-google-slides', slidesTools());
