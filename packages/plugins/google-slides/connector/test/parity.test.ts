import { expect, test } from 'bun:test';
import { referenceTools } from '../../../_shared/reference';
import { ToolContent } from '../../../_shared/google';
import { createToolValidator } from '@openteam/plugin-sdk/json-schema';
import { slidesTools } from '../server';
import { harness } from '../../../test/parity-harness';
import { box, color, element, emu, fill, pageSize, rgb, size, text } from './fixtures';

const base = { presentationId: 'deck', pageObjectId: 'p1' };
const batchPath = '/v1/presentations/deck:batchUpdate';

test('Slides implements exactly the pinned tools with unchanged schemas and matching risk', () => {
  const tools = slidesTools();
  expect(tools.map(t => t.name).sort()).toEqual(referenceTools.slides.map(t => t.name).sort());
  for (const reference of referenceTools.slides) {
    const tool = tools.find(t => t.name === reference.name)!;
    expect(tool.description).toBe(reference.description);
    expect(tool.inputSchema).toEqual({ ...reference.inputSchema, required: reference.inputSchema.required ?? [], additionalProperties: false } as any);
    expect(tool.annotations.readOnlyHint).toBe(reference.annotations.readOnlyHint);
    expect(tool.annotations.destructiveHint).toBe(reference.name === 'delete_object');
    expect(createToolValidator(tool.inputSchema)({ unexpected: 'field' }).valid).toBe(false);
  }
  const compose = createToolValidator(tools.find(t => t.name === 'compose_slide')!.inputSchema);
  expect(compose({ presentationId: 'd', pageObjectId: 'p', root: { kind: 'stack', direction: 'row', children: [{ kind: 'grid', columns: 2, children: [{ kind: 'card', children: [{ kind: 'text', text: 'x', role: 'kpi' }] }, { kind: 'image', url: 'https://e.com/a.png', size: { flex: 2 } }] }] } }).valid).toBe(true);
  expect(compose({ presentationId: 'd', pageObjectId: 'p', root: { kind: 'card', children: [{ kind: 'image', url: 'https://e.com/a.png' }] } }).valid).toBe(false);
});

test('read_presentation renders slides, groups, tables, notes and layouts, and resumes on slide boundaries', async () => {
  const slide = (id: string, words: string) => ({
    objectId: id, slideProperties: { layoutObjectId: 'layout1', notesPage: { objectId: `${id}-notes`, notesProperties: { speakerNotesObjectId: `${id}-sn` }, pageElements: [box(`${id}-sn`, 0, 0, 10, 10, { text: text('Say hello') })] } },
    pageElements: [
      box(`${id}-title`, 0, 0, 100, 50, { placeholder: { type: 'TITLE', parentObjectId: 'lt' }, text: text(words) }),
      { objectId: `${id}-grp`, title: 'Logo group', elementGroup: { children: [box(`${id}-a`, 0, 0, 10, 10, { text: text('A') }), { objectId: `${id}-inner`, elementGroup: { children: [{ objectId: `${id}-deep` }] } }] } },
      { objectId: `${id}-tbl`, table: { rows: 2, columns: 2, tableRows: [{ tableCells: [{ location: { rowIndex: 0, columnIndex: 0 }, text: text('H') }, { location: { rowIndex: 0, columnIndex: 1 } }] }, { tableCells: [] }] } },
      { objectId: `${id}-img`, image: { contentUrl: 'https://secret' } }, { objectId: `${id}-ln`, line: {} },
    ],
  });
  const deck = { presentationId: 'deck', title: 'Deck', revisionId: 'r1', pageSize, layouts: [{ objectId: 'layout1', layoutProperties: { name: 'TITLE_AND_BODY', displayName: 'Title and body' } }], slides: [slide('s0', 'First'), { ...slide('s1', 'x'.repeat(600)), slideProperties: { layoutObjectId: 'layout1', isSkipped: true } }, slide('s2', 'Third')] };
  const h = harness(slidesTools, [deck, deck, deck, deck]);
  const all = await h.call('read_presentation', { presentationId: 'deck' });
  expect(h.requests[0]!.url.pathname).toBe('/v1/presentations/deck');
  expect(h.requests[0]!.url.searchParams.get('fields')).toContain('layouts(objectId,layoutProperties)');
  expect(all).toMatchObject({ title: 'Deck', revisionId: 'r1', slideCount: 3, truncated: false, pageSize: { width: 720, height: 405 }, layouts: [{ objectId: 'layout1', name: 'TITLE_AND_BODY', displayName: 'Title and body' }] });
  const first = all.slides[0];
  expect(first).toMatchObject({ index: 0, objectId: 's0', layoutObjectId: 'layout1', notes: { notesPageId: 's0-notes', speakerNotesObjectId: 's0-sn', text: 'Say hello' } });
  expect(first.elements[0]).toEqual({ objectId: 's0-title', kind: 'shape', shapeType: 'TEXT_BOX', placeholder: 'TITLE', text: 'First' });
  expect(first.elements[1]).toEqual({ objectId: 's0-grp', kind: 'group', title: 'Logo group', children: [{ objectId: 's0-a', kind: 'shape', shapeType: 'TEXT_BOX', text: 'A' }, { objectId: 's0-inner', kind: 'group', memberObjectIds: ['s0-deep'] }] });
  expect(first.elements[2]).toEqual({ objectId: 's0-tbl', kind: 'table', size: '2x2', cells: [{ row: 0, column: 0, text: 'H' }] });
  expect(first.elements.slice(3)).toEqual([{ objectId: 's0-img', kind: 'image' }, { objectId: 's0-ln', kind: 'other' }]);
  expect(JSON.stringify(all)).not.toContain('https://secret');
  expect(all.slides[1].skipped).toBe(true);
  const firstSize = JSON.stringify(first).length;
  const page = await h.call('read_presentation', { presentationId: 'deck', maxChars: firstSize + 10, includeNotes: false });
  expect(page.slides).toHaveLength(1); expect(page.truncated).toBe(true); expect(page.nextSlide).toBe(1); expect(page.slides[0].notes).toBeUndefined();
  const rest = await h.call('read_presentation', { presentationId: 'deck', fromSlide: 2 });
  expect(rest.slides.map((s: any) => s.index)).toEqual([2]); expect(rest.truncated).toBe(false);
  await expect(h.call('read_presentation', { presentationId: 'deck', fromSlide: 1, maxChars: 100 })).rejects.toThrow('raise maxChars');
});

test('create_presentation posts only the title and returns the first slide and its placeholders', async () => {
  const h = harness(slidesTools, [{ presentationId: 'new', title: 'Plan', revisionId: 'r0', pageSize, slides: [{ objectId: 'first', pageElements: [box('t', 0, 0, 1, 1, { placeholder: { type: 'CENTERED_TITLE' } }), box('st', 0, 0, 1, 1, { placeholder: { type: 'SUBTITLE' } })] }] }]);
  const result = await h.call('create_presentation', { title: 'Plan' });
  expect(h.requests[0]!.init.method).toBe('POST'); expect(h.requests[0]!.url.pathname).toBe('/v1/presentations'); expect(h.requests[0]!.json).toEqual({ title: 'Plan' });
  expect(result).toMatchObject({ presentationId: 'new', title: 'Plan', revisionId: 'r0', firstSlideObjectId: 'first', placeholders: [{ objectId: 't', type: 'CENTERED_TITLE' }, { objectId: 'st', type: 'SUBTITLE' }] });
});

const layouts = { revisionId: 'r5', slides: [{ objectId: 'a' }, { objectId: 'b' }], layouts: [
  { objectId: 'L-tb', layoutProperties: { name: 'TITLE_AND_BODY' }, pageElements: [{ objectId: 'L-tb-title', shape: { placeholder: { type: 'TITLE' } } }, { objectId: 'L-tb-body', shape: { placeholder: { type: 'BODY' } } }] },
  { objectId: 'L-blank', layoutProperties: { name: 'BLANK' }, pageElements: [] },
  { objectId: 'L-title', layoutProperties: { name: 'TITLE' }, pageElements: [{ objectId: 'L-t-ct', shape: { placeholder: { type: 'CENTERED_TITLE' } } }, { objectId: 'L-t-sub', shape: { placeholder: { type: 'SUBTITLE' } } }] },
] };
test('add_slide fills layout placeholders in one guarded batch and rejects missing slots before writing', async () => {
  const h = harness(slidesTools, [layouts, { replies: [{}], writeControl: { requiredRevisionId: 'r6' } }, layouts, layouts, layouts, layouts, {}]);
  const result = await h.call('add_slide', { presentationId: 'deck', title: 'Agenda', body: 'One\nTwo', insertionIndex: 1 });
  const write = h.requests[1]!;
  expect(write.url.pathname).toBe(batchPath);
  expect(write.json.writeControl).toEqual({ requiredRevisionId: 'r5' });
  const create = write.json.requests[0].createSlide;
  expect(create).toMatchObject({ objectId: result.slideObjectId, insertionIndex: 1, slideLayoutReference: { layoutId: 'L-tb' } });
  expect(create.placeholderIdMappings).toEqual([{ layoutPlaceholderObjectId: 'L-tb-title', objectId: result.titleObjectId }, { layoutPlaceholderObjectId: 'L-tb-body', objectId: result.bodyObjectId }]);
  expect(write.json.requests.slice(1)).toEqual([{ insertText: { objectId: result.titleObjectId, text: 'Agenda', insertionIndex: 0 } }, { insertText: { objectId: result.bodyObjectId, text: 'One\nTwo', insertionIndex: 0 } }]);
  expect(result.revisionId).toBe('r6');
  await expect(h.call('add_slide', { presentationId: 'deck', layout: 'BLANK', title: 'X' })).rejects.toThrow('Layout BLANK has no title (TITLE or CENTERED_TITLE) placeholder; its placeholders: none');
  await expect(h.call('add_slide', { presentationId: 'deck', layoutId: 'nope' })).rejects.toThrow('Layout nope is not in this deck');
  await expect(h.call('add_slide', { presentationId: 'deck', insertionIndex: 5 })).rejects.toThrow('past the end');
  await expect(h.call('add_slide', { presentationId: 'deck', layout: 'BLANK', layoutId: 'L-blank' })).rejects.toThrow('not both');
  const title = await h.call('add_slide', { presentationId: 'deck', layout: 'TITLE', title: 'Hi', body: 'Sub', requiredRevisionId: 'mine' });
  expect(h.requests.at(-1)!.json.writeControl).toEqual({ requiredRevisionId: 'mine' });
  expect(h.requests.at(-1)!.json.requests[0].createSlide.placeholderIdMappings.map((m: any) => m.layoutPlaceholderObjectId)).toEqual(['L-t-ct', 'L-t-sub']);
  expect(title.revisionId).toBeNull();
  expect(h.requests.filter(r => r.url.pathname === batchPath)).toHaveLength(2);
});

test('Simple writes map to one batchUpdate each with optional WriteControl', async () => {
  const h = harness(slidesTools, Array(8).fill({ replies: [{}] }));
  await h.call('move_slide', { presentationId: 'deck', slideObjectId: 's', newIndex: 3, requiredRevisionId: 'r' });
  await h.call('delete_object', { presentationId: 'deck', objectId: 'x' });
  await h.call('replace_text', { presentationId: 'deck', find: '{{TITLE}}', replace: 'Q3', pageObjectIds: ['s2'] });
  await h.call('replace_text', { presentationId: 'deck', find: 'a', replace: '', matchCase: false });
  await h.call('set_slide_background', { ...base, color: '#0B2A4A' });
  await h.call('set_table_cell_fill', { presentationId: 'deck', objectId: 't', rowIndex: 0, columnIndex: 1, fillColor: '#FFFFFF' });
  await h.call('set_text_style', { presentationId: 'deck', objectId: 't', cellRow: 1, cellColumn: 2, bold: true, fontSize: 12, textColor: '#202124', fontFamily: 'Roboto' });
  await h.call('set_text_style', { presentationId: 'deck', objectId: 's', italic: false });
  const bodies = h.requests.map(r => r.json);
  expect(h.requests.every(r => r.url.pathname === batchPath && r.init.method === 'POST')).toBe(true);
  expect(bodies[0]).toEqual({ requests: [{ updateSlidesPosition: { slideObjectIds: ['s'], insertionIndex: 3 } }], writeControl: { requiredRevisionId: 'r' } });
  expect(bodies[1]).toEqual({ requests: [{ deleteObject: { objectId: 'x' } }] });
  expect(bodies[2].requests[0].replaceAllText).toEqual({ containsText: { text: '{{TITLE}}', matchCase: true }, replaceText: 'Q3', pageObjectIds: ['s2'] });
  expect(bodies[3].requests[0].replaceAllText).toEqual({ containsText: { text: 'a', matchCase: false }, replaceText: '' });
  expect(bodies[4].requests[0]).toEqual({ updatePageProperties: { objectId: 'p1', pageProperties: { pageBackgroundFill: { solidFill: { color: { rgbColor: rgb('#0B2A4A') } } } }, fields: 'pageBackgroundFill.solidFill.color' } });
  expect(bodies[5].requests[0].updateTableCellProperties).toEqual({ objectId: 't', tableRange: { location: { rowIndex: 0, columnIndex: 1 }, rowSpan: 1, columnSpan: 1 }, tableCellProperties: { tableCellBackgroundFill: { solidFill: { color: { rgbColor: { red: 1, green: 1, blue: 1 } } } } }, fields: 'tableCellBackgroundFill.solidFill.color' });
  expect(bodies[6].requests[0].updateTextStyle).toMatchObject({ objectId: 't', cellLocation: { rowIndex: 1, columnIndex: 2 }, textRange: { type: 'ALL' }, style: { bold: true, fontSize: { magnitude: 12, unit: 'PT' }, fontFamily: 'Roboto' }, fields: 'fontSize,bold,fontFamily,foregroundColor' });
  expect(bodies[7].requests[0].updateTextStyle).toEqual({ objectId: 's', textRange: { type: 'ALL' }, style: { italic: false }, fields: 'italic' });
  await expect(h.call('set_text_style', { presentationId: 'deck', objectId: 's' })).rejects.toThrow('at least one');
  await expect(h.call('set_text_style', { presentationId: 'deck', objectId: 's', cellRow: 1, bold: true })).rejects.toThrow('both cellRow and cellColumn');
});

test('A stale requiredRevisionId fails with an actionable message', async () => {
  const h = harness(slidesTools, [new Response(JSON.stringify({ error: { message: 'The required revision ID does not match the latest revision.' } }), { status: 400 })]);
  await expect(h.call('delete_object', { presentationId: 'deck', objectId: 'x', requiredRevisionId: 'old' })).rejects.toThrow('changed since revision old, so nothing was applied');
});

test('duplicate_object offsets an element copy and leaves a slide copy where the API puts it', async () => {
  const h = harness(slidesTools, [{ slides: [{ objectId: 's1' }] }, { replies: [{ duplicateObject: { objectId: 'copy' } }] }, { slides: [{ objectId: 's1' }] }, { replies: [{}] }]);
  await h.call('duplicate_object', { presentationId: 'deck', objectId: 'shape1' });
  const [dup, nudge] = h.requests[1]!.json.requests;
  const copy = dup.duplicateObject.objectIds.shape1;
  expect(dup.duplicateObject.objectId).toBe('shape1');
  expect(nudge.updatePageElementTransform).toEqual({ objectId: copy, applyMode: 'RELATIVE', transform: { scaleX: 1, scaleY: 1, translateX: 10, translateY: 10, unit: 'PT' } });
  await h.call('duplicate_object', { presentationId: 'deck', objectId: 's1', requiredRevisionId: 'r' });
  expect(h.requests[3]!.json.requests).toHaveLength(1); expect(h.requests[3]!.json.writeControl).toEqual({ requiredRevisionId: 'r' });
});

test('set_shape_text replaces whole text atomically, handles cells and notes, and no-ops on empty to empty', async () => {
  const page = { objectId: 'p1', revisionId: 'rv', pageElements: [box('full', 0, 0, 10, 10, { text: text('Old') }), box('empty', 0, 0, 10, 10), { objectId: 'grp', elementGroup: { children: [box('member', 0, 0, 1, 1, { text: { textElements: [{ paragraphMarker: {} }, { textRun: { content: '\n' } }] } })] } }, { objectId: 'tbl', table: { rows: 2, columns: 2, tableRows: [{ tableCells: [{ location: { rowIndex: 0, columnIndex: 0 } }, { location: { rowIndex: 0, columnIndex: 1 }, text: text('x') }] }] } }, { objectId: 'pic', image: {} }] };
  const notes = { objectId: 'n1', revisionId: 'rv', notesProperties: { speakerNotesObjectId: 'sn' }, pageElements: [] };
  const h = harness(slidesTools, [page, { writeControl: { requiredRevisionId: 'rv2' } }, page, page, { }, page, page, page, page, notes, {}, page, {}]);
  expect(await h.call('set_shape_text', { ...base, objectId: 'full', text: 'New' })).toEqual({ revisionId: 'rv2' });
  expect(h.requests[1]!.json).toEqual({ requests: [{ deleteText: { objectId: 'full', textRange: { type: 'ALL' } } }, { insertText: { objectId: 'full', text: 'New', insertionIndex: 0 } }], writeControl: { requiredRevisionId: 'rv' } });
  expect(await h.call('set_shape_text', { ...base, objectId: 'empty', text: '' })).toEqual({ noop: true, revisionId: 'rv' });
  await h.call('set_shape_text', { ...base, objectId: 'tbl', cell: { row: 0, column: 1 }, text: 'Cell', requiredRevisionId: 'mine' });
  expect(h.requests[4]!.json).toEqual({ requests: [{ deleteText: { objectId: 'tbl', cellLocation: { rowIndex: 0, columnIndex: 1 }, textRange: { type: 'ALL' } } }, { insertText: { objectId: 'tbl', cellLocation: { rowIndex: 0, columnIndex: 1 }, text: 'Cell', insertionIndex: 0 } }], writeControl: { requiredRevisionId: 'mine' } });
  await expect(h.call('set_shape_text', { ...base, objectId: 'tbl', text: 'x' })).rejects.toThrow('give cell {rowIndex, columnIndex}');
  await expect(h.call('set_shape_text', { ...base, objectId: 'full', cell: { rowIndex: 0, columnIndex: 0 }, text: 'x' })).rejects.toThrow('cell is only for tables');
  await expect(h.call('set_shape_text', { ...base, objectId: 'tbl', cell: { rowIndex: 2, columnIndex: 0 }, text: 'x' })).rejects.toThrow('outside the 2x2 table');
  await expect(h.call('set_shape_text', { ...base, objectId: 'pic', text: 'x' })).rejects.toThrow('image, which holds no text');
  await h.call('set_shape_text', { presentationId: 'deck', pageObjectId: 'n1', objectId: 'sn', text: 'Remember the demo' });
  expect(h.requests[9]!.url.pathname).toBe('/v1/presentations/deck/pages/n1');
  expect(h.requests[10]!.json.requests).toEqual([{ insertText: { objectId: 'sn', text: 'Remember the demo', insertionIndex: 0 } }]);
  await h.call('set_shape_text', { ...base, objectId: 'member', text: 'In group' });
  expect(h.requests[12]!.json.requests).toEqual([{ insertText: { objectId: 'member', text: 'In group', insertionIndex: 0 } }]);
  await expect(harness(slidesTools, [page]).call('set_shape_text', { ...base, objectId: 'ghost', text: 'x' })).rejects.toThrow('not on page p1');
});

test('Insert tools place elements in points and style them in the same batch', async () => {
  const h = harness(slidesTools, Array(4).fill({ writeControl: { requiredRevisionId: 'after' } }));
  const tb = await h.call('insert_text_box', { ...base, text: 'Title', x: 40, y: 32, width: 640, height: 60, bold: true, fontSize: 34, textColor: '#FFFFFF', textAlignment: 'CENTER' });
  expect(tb.revisionId).toBe('after');
  const [create, insert, style, para] = h.requests[0]!.json.requests;
  expect(create.createShape).toEqual({ objectId: tb.objectId, shapeType: 'TEXT_BOX', elementProperties: { pageObjectId: 'p1', size: { width: { magnitude: 640, unit: 'PT' }, height: { magnitude: 60, unit: 'PT' } }, transform: { scaleX: 1, scaleY: 1, translateX: 40, translateY: 32, unit: 'PT' } } });
  expect(insert.insertText).toEqual({ objectId: tb.objectId, text: 'Title', insertionIndex: 0 });
  expect(style.updateTextStyle).toEqual({ objectId: tb.objectId, textRange: { type: 'ALL' }, style: { fontSize: { magnitude: 34, unit: 'PT' }, bold: true, foregroundColor: { opaqueColor: { rgbColor: { red: 1, green: 1, blue: 1 } } } }, fields: 'fontSize,bold,foregroundColor' });
  expect(para.updateParagraphStyle).toEqual({ objectId: tb.objectId, textRange: { type: 'ALL' }, style: { alignment: 'CENTER' }, fields: 'alignment' });
  const shape = await h.call('insert_shape', { ...base, shapeType: 'ELLIPSE', fillColor: '#1E4976', outlineColor: '#4FC3F7' });
  const shapeRequests = h.requests[1]!.json.requests;
  expect(shapeRequests[0].createShape.elementProperties.transform).toMatchObject({ translateX: 50, translateY: 50 });
  expect(shapeRequests[0].createShape.elementProperties.size.width.magnitude).toBe(300);
  expect(shapeRequests[1].updateShapeProperties).toEqual({ objectId: shape.objectId, shapeProperties: { shapeBackgroundFill: { solidFill: { color: { rgbColor: rgb('#1E4976') } } }, outline: { outlineFill: { solidFill: { color: { rgbColor: rgb('#4FC3F7') } } }, propertyState: 'RENDERED' } }, fields: 'shapeBackgroundFill.solidFill.color,outline.outlineFill.solidFill.color,outline.propertyState' });
  expect(shapeRequests).toHaveLength(2);
  const table = await h.call('insert_table', { ...base, rows: 3, columns: 4, requiredRevisionId: 'r' });
  expect(h.requests[2]!.json).toMatchObject({ requests: [{ createTable: { objectId: table.objectId, rows: 3, columns: 4 } }], writeControl: { requiredRevisionId: 'r' } });
  const line = await h.call('insert_line', { ...base, x1: 600, y1: 100, x2: 100, y2: 100, color: '#FF0000', endArrow: 'FILL_ARROW', startArrow: '' });
  const [createLine, lineStyle] = h.requests[3]!.json.requests;
  expect(createLine.createLine).toEqual({ objectId: line.objectId, category: 'STRAIGHT', elementProperties: { pageObjectId: 'p1', size: { width: { magnitude: emu(500), unit: 'EMU' }, height: { magnitude: 1, unit: 'EMU' } }, transform: { scaleX: -1, scaleY: 1, translateX: emu(600), translateY: emu(100), unit: 'EMU' } } });
  expect(lineStyle.updateLineProperties).toEqual({ objectId: line.objectId, lineProperties: { weight: { magnitude: 1, unit: 'PT' }, lineFill: { solidFill: { color: { rgbColor: { red: 1, green: 0, blue: 0 } } } }, endArrow: 'FILL_ARROW' }, fields: 'weight,lineFill,endArrow' });
  await expect(h.call('insert_line', { ...base, x1: 1, y1: 1, x2: 1, y2: 1 })).rejects.toThrow('same point');
});

test('connect_shapes snaps to the closest connection sites and guards with the read revision', async () => {
  const page = { objectId: 'p1', revisionId: 'rv', pageElements: [element('a', 40, 100, 100, 60, { shape: { shapeType: 'RECTANGLE' } }), element('b', 300, 100, 100, 60, { shape: { shapeType: 'ROUND_RECTANGLE' } }), element('c', 40, 300, 100, 100, { shape: { shapeType: 'ELLIPSE' } })] };
  const h = harness(slidesTools, [page, {}, page, {}]);
  const result = await h.call('connect_shapes', { ...base, startObjectId: 'a', endObjectId: 'b' });
  expect(result).toMatchObject({ startConnectionSite: 3, endConnectionSite: 1 });
  const [create, style] = h.requests[1]!.json.requests;
  expect(create.createLine).toMatchObject({ objectId: result.objectId, category: 'BENT', elementProperties: { size: { width: { magnitude: emu(160) }, height: { magnitude: 1 } }, transform: { translateX: emu(140), translateY: emu(130) } } });
  expect(style.updateLineProperties.lineProperties).toEqual({ startConnection: { connectedObjectId: 'a', connectionSiteIndex: 3 }, endConnection: { connectedObjectId: 'b', connectionSiteIndex: 1 }, weight: { magnitude: 1, unit: 'PT' }, endArrow: 'FILL_ARROW' });
  expect(h.requests[1]!.json.writeControl).toEqual({ requiredRevisionId: 'rv' });
  const down = await h.call('connect_shapes', { ...base, startObjectId: 'a', endObjectId: 'c', category: 'STRAIGHT', endArrow: 'NONE', weightPt: 2 });
  expect(down).toMatchObject({ startConnectionSite: 2, endConnectionSite: 0 });
  expect(h.requests[3]!.json.requests[1].updateLineProperties.lineProperties).toMatchObject({ endArrow: 'NONE', weight: { magnitude: 2 } });
  await expect(harness(slidesTools, [page]).call('connect_shapes', { ...base, startObjectId: 'a', endObjectId: 'zz' })).rejects.toThrow('both shapes must be on that slide');
});

test('insert_image fits inside the default box and reports the fitted size from a read-back', async () => {
  const fitted = element('', 0, 0, 400, 300, { image: {} }, { scaleX: 0.5, scaleY: 0.5, translateX: emu(210), translateY: emu(50) });
  const h = harness(slidesTools, [{ pageSize }, { replies: [{}], writeControl: { requiredRevisionId: 'r2' } }, (r: any) => ({ objectId: 'p1', pageElements: [{ ...fitted, objectId: h.requests[1]!.json.requests[0].createImage.objectId }] })]);
  const result = await h.call('insert_image', { ...base, imageUrl: 'https://example.com/chart.png' });
  expect(h.requests[0]!.url.searchParams.get('fields')).toBe('pageSize');
  const create = h.requests[1]!.json.requests[0].createImage;
  expect(create).toMatchObject({ url: 'https://example.com/chart.png', elementProperties: { size: { width: { magnitude: 620 }, height: { magnitude: 305 } }, transform: { translateX: 50, translateY: 50 } } });
  expect(result).toEqual({ objectId: create.objectId, x: 210, y: 50, width: 200, height: 150, revisionId: 'r2' });
  const g = harness(slidesTools, [{}, new Response('boom', { status: 500 })]);
  const fallback = await g.call('insert_image', { ...base, imageUrl: 'https://example.com/a.png', maxWidth: 100, maxHeight: 80, x: 10, y: 20 });
  expect(fallback).toMatchObject({ x: 10, y: 20, width: 100, height: 80, fitted: false });
  await expect(harness(slidesTools, [{ pageSize }]).call('insert_image', { ...base, imageUrl: 'https://e.com/a.png', x: 700 })).rejects.toThrow('leave no room');
});

test('update_element_position moves the absolute box and keeps the size, including inside scaled groups', async () => {
  const page = { objectId: 'p1', revisionId: 'rv', pageElements: [
    element('card', 100, 100, 200, 100, { shape: { shapeType: 'RECTANGLE' } }, { scaleX: 1.5, scaleY: 0.5 }),
    { objectId: 'g', transform: { scaleX: 2, scaleY: 2, translateX: emu(10), translateY: emu(20), unit: 'EMU' }, elementGroup: { children: [element('child', 5, 5, 10, 10, { shape: { shapeType: 'RECTANGLE' } })] } },
  ] };
  const h = harness(slidesTools, [page, {}, page, {}]);
  await h.call('update_element_position', { ...base, objectId: 'card', x: 40, y: 130 });
  expect(h.requests[1]!.json).toEqual({ requests: [{ updatePageElementTransform: { objectId: 'card', applyMode: 'ABSOLUTE', transform: { scaleX: 1.5, scaleY: 0.5, shearX: 0, shearY: 0, translateX: emu(40), translateY: emu(130), unit: 'EMU' } } }], writeControl: { requiredRevisionId: 'rv' } });
  // child renders at (20,30) 20x20; moving it to (60,30) is +40 pt on the page = +20 in the 2x group space.
  await h.call('update_element_position', { ...base, objectId: 'child', x: 60, y: 30 });
  expect(h.requests[3]!.json.requests[0].updatePageElementTransform.transform).toMatchObject({ scaleX: 1, scaleY: 1, translateX: emu(25), translateY: emu(5) });
});

test('get_slide_thumbnail returns the PNG and its size without sending the token to the content URL', async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const thumb = { width: 1600, height: 900, contentUrl: 'https://lh7-rt.googleusercontent.com/slides/abc' };
  const make = (responses: any[]) => { const h = harness(api => slidesTools(api, (url, init) => (api as any).fetcher(url, init)), responses); return h; };
  const h = make([thumb, new Response(png, { headers: { 'content-type': 'image/png' } })]);
  const result = await h.call('get_slide_thumbnail', { ...base, size: 'LARGE' });
  expect(h.requests[0]!.url.pathname).toBe('/v1/presentations/deck/pages/p1/thumbnail');
  expect(Object.fromEntries(h.requests[0]!.url.searchParams)).toEqual({ 'thumbnailProperties.thumbnailSize': 'LARGE', 'thumbnailProperties.mimeType': 'PNG' });
  expect(h.requests[1]!.url.href).toBe(thumb.contentUrl);
  expect(JSON.stringify(h.requests[1]!.init.headers ?? {})).not.toContain('fixture-token');
  expect(result).toBeInstanceOf(ToolContent);
  expect(result.content).toEqual([{ type: 'image', data: png.toString('base64'), mimeType: 'image/png' }, { type: 'text', text: JSON.stringify({ pageObjectId: 'p1', width: 1600, height: 900 }) }]);
  const d = make([{ ...thumb, width: 800 }, new Response(png)]);
  await d.call('get_slide_thumbnail', base);
  expect(d.requests[0]!.url.searchParams.get('thumbnailProperties.thumbnailSize')).toBe('MEDIUM');
  await expect(make([{ ...thumb, contentUrl: 'https://evil.example/x.png' }]).call('get_slide_thumbnail', base)).rejects.toThrow('unexpected thumbnail URL');
  await expect(make([{ ...thumb, contentUrl: 'http://lh3.googleusercontent.com/x' }]).call('get_slide_thumbnail', base)).rejects.toThrow('unexpected thumbnail URL');
  await expect(make([thumb, new Response(new Uint8Array(26 * 1024 * 1024))]).call('get_slide_thumbnail', base)).rejects.toThrow('Thumbnail exceeds');
  const flaky = make([thumb, new Response('', { status: 502 }), new Response(png, { headers: { 'content-type': 'image/png' } })]);
  expect((await flaky.call('get_slide_thumbnail', base)).content[0].data).toBe(png.toString('base64'));
  expect(flaky.requests.slice(1).map(r => r.url.href)).toEqual([thumb.contentUrl, thumb.contentUrl]);
  await expect(make([thumb, ...[1, 2, 3].map(() => new Response('', { status: 502 }))]).call('get_slide_thumbnail', base)).rejects.toThrow('HTTP 502');
});

test('The stdio server lists exactly the pinned tools plus read_result', async () => {
  const proc = Bun.spawn(['bun', `${import.meta.dir}/../server.ts`], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', env: { ...process.env, GOOGLE_ACCESS_TOKEN: 'x' } });
  const send = (message: unknown) => proc.stdin.write(`${JSON.stringify(message)}\n`);
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'check_contrast', arguments: { pairs: [{ text: '#FFFFFF', background: '#000000' }] } } });
  send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'compose_slide', arguments: { presentationId: 'd', pageObjectId: 'p', root: { kind: 'stack', direction: 'column', children: [{ kind: 'text', text: 'x', role: 'h9' }] } } } });
  await proc.stdin.flush();
  const reader = proc.stdout.getReader(), replies = new Map<number, any>();
  let buffer = '';
  while (replies.size < 4) {
    const next = await reader.read();
    if (next.done) break;
    buffer += new TextDecoder().decode(next.value);
    for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) { const line = buffer.slice(0, at); buffer = buffer.slice(at + 1); if (line.trim()) { const m = JSON.parse(line); if (m.id) replies.set(m.id, m); } }
  }
  proc.kill();
  expect(replies.get(2).result.tools.map((t: any) => t.name).sort()).toEqual([...referenceTools.slides.map(t => t.name), 'read_result'].sort());
  expect(JSON.parse(replies.get(3).result.content[0].text).results[0]).toMatchObject({ ratio: 21, passesAA: true });
  expect(replies.get(4).result.isError).toBe(true);
  expect(replies.get(4).result.content[0].text).toContain('Invalid tool arguments');
}, 20_000);
