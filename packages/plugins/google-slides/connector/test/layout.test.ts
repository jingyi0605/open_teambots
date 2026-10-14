import { expect, test } from 'bun:test';
import { ToolContent } from '../../../_shared/google';
import { slidesTools } from '../server';
import { compileHtml } from '../html';
import { checkPair, contrast } from '../contrast';
import { measure, paragraphsOf } from '../text';
import { harness } from '../../../test/parity-harness';
import { box, color, element, emu, fill, pageSize, rgb, size, text } from './fixtures';

const base = { presentationId: 'deck', pageObjectId: 'p1' };
const deck = { revisionId: 'r1', pageSize, slides: [{ objectId: 'p1', pageElements: [{ objectId: 'old-title' }, { objectId: 'old-body' }] }] };
const kpiTree = { kind: 'stack', direction: 'column', children: [
  { kind: 'text', text: 'Q3 results', role: 'h1' },
  { kind: 'stack', direction: 'row', size: 150, gap: 24, children: ['Revenue:$4.2M', 'Customers:1,240', 'NPS:62'].map(pair => ({ kind: 'card', children: [{ kind: 'text', text: pair.split(':')[0], role: 'caption', color: 'textSecondary' }, { kind: 'text', text: pair.split(':')[1], role: 'kpi' }] })) },
] };
const created = (requests: any[], key: string) => requests.filter(r => r[key]).map(r => r[key]);
const pt = (v: any) => v.magnitude;

test('check_contrast computes WCAG ratios, the large-text threshold and the nearest passing tint or shade', async () => {
  const h = harness(slidesTools);
  const { results } = await h.call('check_contrast', { pairs: [{ text: '#FFFFFF', background: '#000000' }, { text: '#767676', background: '#FFFFFF' }, { text: '#777777', background: '#ffffff' }, { text: '#777777', background: '#FFFFFF', large: true }, { text: '#4FC3F7', background: '#1E4976' }] });
  expect(h.requests).toHaveLength(0);
  expect(results[0]).toEqual({ text: '#FFFFFF', background: '#000000', large: false, ratio: 21, required: 4.5, passesAA: true });
  expect(results[1]).toMatchObject({ ratio: 4.54, passesAA: true });
  expect(results[2]).toMatchObject({ ratio: 4.47, passesAA: false, suggestionKind: 'shade' });
  expect(contrast(results[2].suggestion, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
  expect(results[2].suggestion > '#700000' && results[2].suggestion < '#777777').toBe(true);
  expect(results[3]).toMatchObject({ required: 3, passesAA: true });
  expect(checkPair({ text: '#1E4976', background: '#0B2A4A' })).toMatchObject({ passesAA: false, suggestionKind: 'tint' });
});

test('Wrapped-height estimates match the skill guidance for a 34 pt bold title in a 600 pt box', () => {
  const lines = (s: string) => measure(paragraphsOf(s, 34, true), 600).lines;
  expect(lines('Quarterly business review 2026')).toBe(1);
  expect(lines('Quarterly business review and the outlook for 2027')).toBe(2);
  expect(measure(paragraphsOf('One\nTwo\nThree', 16), 300).lines).toBe(3);
  expect(measure(paragraphsOf('W'.repeat(80), 16), 200).lines).toBeGreaterThan(5);
});

test('compose_slide lays out a KPI slide in one batch with themed colors, equal cards and plan lints', async () => {
  const h = harness(slidesTools, [deck, { writeControl: { requiredRevisionId: 'r2' } }]);
  const result = await h.call('compose_slide', { ...base, root: kpiTree });
  expect(h.requests[0]!.url.searchParams.get('fields')).toContain('pageSize');
  const body = h.requests[1]!.json;
  expect(body.writeControl).toBeUndefined();
  expect(body.requests[0]).toEqual({ updatePageProperties: { objectId: 'p1', pageProperties: { pageBackgroundFill: { solidFill: { color: { rgbColor: rgb('#0B2A4A') } } } }, fields: 'pageBackgroundFill.solidFill.color' } });
  const shapes = created(body.requests, 'createShape');
  const cards = shapes.filter(s => s.shapeType === 'ROUND_RECTANGLE');
  expect(cards).toHaveLength(3);
  expect(cards.map(c => pt(c.elementProperties.size.width))).toEqual([192, 192, 192]);
  expect(cards.map(c => c.elementProperties.transform.translateX)).toEqual([48, 264, 480]);
  expect(cards.every(c => pt(c.elementProperties.size.height) === 150)).toBe(true);
  const fills = created(body.requests, 'updateShapeProperties');
  expect(fills[0]).toMatchObject({ shapeProperties: { shapeBackgroundFill: { solidFill: { color: { rgbColor: rgb('#1E4976') } } }, outline: { propertyState: 'NOT_RENDERED' } } });
  const styles = created(body.requests, 'updateTextStyle');
  expect(styles[0]).toMatchObject({ style: { fontSize: { magnitude: 28 }, bold: true, foregroundColor: { opaqueColor: { rgbColor: rgb('#FFFFFF') } } } });
  expect(styles[1]).toMatchObject({ style: { fontSize: { magnitude: 12 }, bold: false, foregroundColor: { opaqueColor: { rgbColor: rgb('#B8CCE0') } } } });
  expect(created(body.requests, 'updateParagraphStyle')[1]).toMatchObject({ style: { alignment: 'CENTER', lineSpacing: 100 } });
  expect(result.revisionId).toBe('r2');
  expect(result.rootBox).toEqual({ x: 48, y: 48, width: 624, height: 309 });
  expect(result.issues).toEqual([]);
  const texts = result.elements.filter((e: any) => e.kind === 'text');
  expect(texts.map((t: any) => t.colorRole)).toEqual(['onBackground', 'textSecondary', 'onSurface', 'textSecondary', 'onSurface', 'textSecondary', 'onSurface']);
  const [card] = result.elements.filter((e: any) => e.kind === 'card'), inside = texts.slice(1, 3);
  for (const t of inside) { expect(t.box.x).toBeGreaterThanOrEqual(card.box.x); expect(t.box.y + t.box.height).toBeLessThanOrEqual(card.box.y + card.box.height); }
  expect(Math.abs((inside[0].box.y - card.box.y) - (card.box.y + card.box.height - inside[1].box.y - inside[1].box.height))).toBeLessThan(0.2);
});

test('compose_slide clears the slide under a revision guard, centers a title slide and shrinks text to fit', async () => {
  const h = harness(slidesTools, [deck, {}]);
  const result = await h.call('compose_slide', { ...base, clear: true, margin: 40, theme: { palette: { background: '#FFFFFF' }, type: { family: 'Roboto', scale: { display: 48 } } }, root: { kind: 'stack', direction: 'column', justify: 'center', children: [
    { kind: 'text', text: 'Project Atlas', role: 'display', align: 'center' },
    { kind: 'text', text: 'Quarterly review', role: 'h2', color: 'textSecondary', align: 'center' },
    { kind: 'text', text: 'A very long footnote that will not fit at this size. '.repeat(8), role: 'body', size: 30, fit: 'shrink' },
  ] } });
  const body = h.requests[1]!.json;
  expect(body.writeControl).toEqual({ requiredRevisionId: 'r1' });
  expect(body.requests.slice(0, 2)).toEqual([{ deleteObject: { objectId: 'old-title' } }, { deleteObject: { objectId: 'old-body' } }]);
  expect(result.deleted).toEqual(['old-title', 'old-body']);
  expect(created(body.requests, 'updateTextStyle')[0].style).toMatchObject({ fontSize: { magnitude: 48 }, fontFamily: 'Roboto', foregroundColor: { opaqueColor: { rgbColor: rgb('#202124') } } });
  const [title, subtitle, note] = result.elements;
  expect(title.box.x).toBe(40); expect(title.align).toBe('CENTER');
  const top = title.box.y - 40, bottom = 405 - 40 - (note.box.y + note.box.height);
  expect(Math.abs(top - bottom)).toBeLessThan(0.2);
  expect(contrast(subtitle.color, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
  expect(note.fontSize).toBeLessThan(16); expect(note.fits).toBe(true); expect(note.box.height).toBe(30);
  expect(result.palette).toMatchObject({ background: '#FFFFFF', onBackground: '#202124', primary: '#0B57D0' });
});

test('compose_slide reports text_overflow and off_slide on the plan', async () => {
  const h = harness(slidesTools, [deck, {}]);
  const result = await h.call('compose_slide', { ...base, margin: 0, root: { kind: 'stack', direction: 'column', gap: 0, children: [{ kind: 'text', text: 'Lorem ipsum dolor sit amet '.repeat(40), role: 'body', size: 60 }, { kind: 'stack', direction: 'row', gap: 0, size: 100, children: [{ kind: 'image', url: 'https://example.com/a.png', size: 500 }, { kind: 'image', url: 'https://example.com/b.png', size: 400 }] }] } });
  expect(result.issues.map((i: any) => i.type).sort()).toEqual(['off_slide', 'text_overflow']);
  expect(result.issues.find((i: any) => i.type === 'text_overflow').severity).toBe('error');
  const images = created(h.requests[1]!.json.requests, 'createImage');
  expect(images.map(i => i.url)).toEqual(['https://example.com/a.png', 'https://example.com/b.png']);
  expect(pt(images[0].elementProperties.size.width)).toBe(500);
});

test('compose_slide refuses failing contrast pairs and bad input before writing anything', async () => {
  const h = harness(slidesTools, [deck, deck, deck]);
  await expect(h.call('compose_slide', { ...base, theme: { palette: { surface: '#FFFFFF', textSecondary: '#DDDDDD' } }, root: { kind: 'card', children: [{ kind: 'text', text: 'Revenue', color: 'textSecondary' }] } })).rejects.toThrow('text "Revenue" in textSecondary #DDDDDD on surface #FFFFFF is 1.35:1, needs 4.5:1 (use #767676');
  await expect(h.call('compose_slide', { ...base, root: { kind: 'stack', direction: 'column', children: [{ kind: 'text', text: 'Body', color: '#123456' }] } })).rejects.toThrow('Refused before writing');
  await expect(h.call('compose_slide', { ...base, root: { kind: 'stack', direction: 'row', children: [{ kind: 'spacer', size: 700 }, { kind: 'image', url: 'https://e.com/i.png' }] } })).rejects.toThrow('No room for the image');
  await expect(h.call('compose_slide', { ...base })).rejects.toThrow('exactly one of root');
  await expect(h.call('compose_slide', { ...base, root: kpiTree, html: '<section></section>' })).rejects.toThrow('exactly one of root');
  await expect(harness(slidesTools, [{ ...deck, slides: [] }]).call('compose_slide', { ...base, root: kpiTree })).rejects.toThrow('Slide p1 is not in this presentation');
  expect(h.requests.filter(r => r.init.method === 'POST')).toHaveLength(0);
});

test('compose_slide HTML compiles to the same layout as the tree and refuses unsupported markup by name', async () => {
  const html = `<section style="background:#0B2A4A; padding:48pt; gap:16pt">
    <h1>Q3 results</h1>
    <div style="display:flex; gap:24pt; height:150pt">
      <article class="card"><span class="caption" style="color:textSecondary">Revenue</span><span class="kpi">$4.2M</span></article>
      <article class="card"><span class="caption" style="color:textSecondary">Customers</span><span class="kpi">1,240</span></article>
      <article class="card"><span class="caption" style="color:textSecondary">NPS</span><span class="kpi">62</span></article>
    </div>
  </section>`;
  const fromTree = harness(slidesTools, [deck, {}]), fromHtml = harness(slidesTools, [deck, {}]);
  const a = await fromTree.call('compose_slide', { ...base, root: kpiTree }), b = await fromHtml.call('compose_slide', { ...base, html });
  const strip = (r: any) => r.elements.map(({ objectId, ...rest }: any) => rest);
  expect(strip(b)).toEqual(strip(a));
  expect(compileHtml('<div style="display:grid; grid-template-columns: repeat(2, 1fr)"><p>a</p><p>b</p><p>c</p></div>').root).toEqual({ kind: 'grid', columns: 2, rows: 2, children: [{ kind: 'text', text: 'a', role: 'body' }, { kind: 'text', text: 'b', role: 'body' }, { kind: 'text', text: 'c', role: 'body' }] });
  expect(compileHtml('<section><ol class="caption"><li>One &amp; two<ul><li>Nested</li></ul></li><li>Three</ol><hr style="height:12px"><img src="https://e.com/a.png" alt="Chart" style="flex:2"><p class="shrink" style="text-align:right; font-weight:700; font-size:18px">End</p></section>').root).toEqual({ kind: 'stack', direction: 'column', children: [
    { kind: 'text', text: 'One & two\n\tNested\nThree', role: 'caption', numbered: true },
    { kind: 'spacer', size: 9 },
    { kind: 'image', url: 'https://e.com/a.png', alt: 'Chart', size: { flex: 2 } },
    { kind: 'text', text: 'End', role: 'body', align: 'end', bold: true, fontSize: 13.5, fit: 'shrink' },
  ] });
  const h = harness(slidesTools, [deck]);
  const bad = '<section style="margin:4pt"><table></table><p id="x" style="color:red">Hi <b>there</b></p><div class="hero" style="background:#fff"><p>x</p></div><div style="width:100pt"><p>y</p></div></section>';
  const error = await h.call('compose_slide', { ...base, html: bad }).catch(e => e.message);
  for (const name of ['CSS property "margin"', 'tag <table>', 'attribute "id" on <p>', 'color: red on <p>', '<b> inside <p>', 'class "hero"', 'CSS "background" on <div> (only the root and cards take a background)', 'width on <div> inside a column']) expect(error).toContain(name);
  expect(h.requests).toHaveLength(0);
  expect(() => compileHtml('<section><div><p>x</section>')).toThrow('Malformed HTML');
  expect(() => compileHtml('<!doctype html><section></section>')).toThrow('doctype');
});

test('insert_grid places cells CSS-grid style with spans, card styling and returned boxes', async () => {
  const h = harness(slidesTools, [{ writeControl: { requiredRevisionId: 'g2' } }, {}]);
  const result = await h.call('insert_grid', { ...base, columns: 3, cells: [
    { text: '$4.2M', subtext: 'Revenue', fillColor: '#1E4976' },
    { text: '1,240', subtext: 'Customers', fillColor: '#F1F3F4', textColor: '#202124', subtextColor: '#444746' },
    { imageUrl: 'https://example.com/chart.png', rowSpan: 2 },
    { text: 'Notes span two columns', colSpan: 2 },
  ] });
  expect(result).toMatchObject({ revisionId: 'g2', region: { x: 40, y: 130, width: 640, height: 235 }, columns: 3, rows: 2, issues: [] });
  const w = (640 - 32) / 3, hgt = (235 - 16) / 2;
  expect(result.elements.map((e: any) => [e.kind, e.row, e.column, e.box.x, e.box.width])).toEqual([['card', 0, 0, 40, Math.round(w * 10) / 10], ['card', 0, 1, Math.round((40 + w + 16) * 10) / 10, Math.round(w * 10) / 10], ['image', 0, 2, Math.round((40 + 2 * (w + 16)) * 10) / 10, Math.round(w * 10) / 10], ['text', 1, 0, 40, Math.round((2 * w + 16) * 10) / 10]]);
  expect(result.elements[2].box.height).toBe(235);
  expect(result.elements[3].box.y).toBe(Math.round((130 + hgt + 16) * 10) / 10);
  const requests = h.requests[0]!.json.requests;
  const card = created(requests, 'createShape')[0];
  expect(card.shapeType).toBe('ROUND_RECTANGLE');
  expect(created(requests, 'updateShapeProperties')[0]).toMatchObject({ shapeProperties: { contentAlignment: 'MIDDLE', outline: { propertyState: 'NOT_RENDERED' } } });
  const styles = created(requests, 'updateTextStyle').filter(s => s.objectId === card.objectId);
  expect(styles[0]).toMatchObject({ textRange: { type: 'ALL' }, style: { fontSize: { magnitude: 28 }, bold: true, foregroundColor: { opaqueColor: { rgbColor: rgb('#FFFFFF') } } } });
  expect(styles[1]).toMatchObject({ textRange: { type: 'FIXED_RANGE', startIndex: 6, endIndex: 13 }, style: { fontSize: { magnitude: 14 }, bold: false } });
  expect(created(requests, 'insertText')[0].text).toBe('$4.2M\nRevenue');
  const textCell = created(requests, 'createShape')[2];
  expect(textCell.shapeType).toBe('TEXT_BOX');
  expect(created(requests, 'updateParagraphStyle').find(p => p.objectId === textCell.objectId).style.alignment).toBe('START');
  expect(created(requests, 'createImage')[0].url).toBe('https://example.com/chart.png');
  const tight = await h.call('insert_grid', { ...base, columns: 1, height: 40, cells: [{ text: 'This headline is far too long to fit in one small card', fillColor: '#FFFFFF', textColor: '#AAAAAA' }] });
  expect(tight.issues.map((i: any) => i.type).sort()).toEqual(['low_contrast', 'text_overflow']);
  await expect(h.call('insert_grid', { ...base, columns: 2, rows: 1, cells: [{ text: 'a' }, { text: 'b' }, { text: 'c' }] })).rejects.toThrow('need 2 rows');
  await expect(h.call('insert_grid', { ...base, columns: 2, cells: [{ text: 'a', colSpan: 3 }] })).rejects.toThrow('spans 3 columns');
  await expect(h.call('insert_grid', { ...base, columns: 1, cells: [{ kind: 'image' }] })).rejects.toThrow('without imageUrl');
});

const layoutDeck = { revisionId: 'r9', pageSize, layouts: [{ objectId: 'L1', pageElements: [box('lt-title', 0, 0, 10, 10, { placeholder: { type: 'TITLE', parentObjectId: 'm-title' }, text: text('x', { ...size(36), bold: true }) })] }], masters: [{ objectId: 'M', pageElements: [box('m-title', 0, 0, 10, 10, { placeholder: { type: 'TITLE' }, text: text('x', color('#FFFFFF')) })] }] };
const slidePage = { objectId: 'p1', revisionId: 'r9', pageProperties: { pageBackgroundFill: { solidFill: { color: { rgbColor: rgb('#0B2A4A') } } } }, pageElements: [
  box('title', 40, 32, 640, 60, { placeholder: { type: 'TITLE', parentObjectId: 'lt-title' }, text: text('Quarterly review') }),
  element('card', 40, 130, 200, 150, { shape: { shapeType: 'ROUND_RECTANGLE', shapeProperties: fill('#F1F3F4') } }),
  box('label', 56, 150, 168, 40, { text: text('Revenue', { ...size(14), ...color('#FFFFFF') }) }),
  box('long', 260, 130, 200, 40, { text: text('This sentence is much too long to fit inside a forty point tall box at this size', { ...size(18), ...color('#FFFFFF') }) }),
  element('card2', 470, 133, 200, 160, { shape: { shapeType: 'ROUND_RECTANGLE', shapeProperties: fill('#1E4976') } }),
  box('spill', 600, 250, 160, 30, { text: text('Off', { ...size(12), ...color('#FFFFFF') }) }),
  box('themed', 260, 300, 150, 40, { text: text('Theme colored', size(12)) }),
  box('empty', 40, 370, 300, 30, { placeholder: { type: 'BODY' } }),
  { objectId: 'grp', transform: { scaleX: 2, scaleY: 2, translateX: emu(500), translateY: emu(10), unit: 'EMU' }, elementGroup: { children: [element('logo', 0, 0, 40, 20, { image: {} }), element('mark', 40, 0, 20, 20, { shape: { shapeType: 'ELLIPSE', shapeProperties: { shapeBackgroundFill: { solidFill: { color: { themeColor: 'ACCENT1' } } } } } })] } },
  element('tbl', 40, 200, 10, 10, { table: { rows: 1, columns: 1, tableRows: [{ tableCells: [{ location: { rowIndex: 0, columnIndex: 0 }, text: text('Dim', { ...size(12), ...color('#333333') }), tableCellProperties: { tableCellBackgroundFill: { solidFill: { color: { rgbColor: rgb('#222222') } } } } }] }] } }),
] };

test('read_slide_layout reports absolute boxes, inherited styles and every lint with offending ids', async () => {
  const h = harness(slidesTools, [slidePage, layoutDeck]);
  const result = await h.call('read_slide_layout', { ...base, format: 'json' });
  expect(h.requests[0]!.url.pathname).toBe('/v1/presentations/deck/pages/p1');
  expect(h.requests[1]!.url.searchParams.get('fields')).toContain('masters(objectId,pageElements)');
  expect(result).toMatchObject({ revisionId: 'r9', slide: { width: 720, height: 405 }, background: '#0B2A4A' });
  const byId = Object.fromEntries(result.elements.map((e: any) => [e.objectId, e]));
  expect(byId.title).toMatchObject({ z: 0, kind: 'text', placeholder: 'TITLE', box: { x: 40, y: 32, width: 640, height: 60 }, textStyle: { fontSize: 36, bold: true, color: '#FFFFFF', align: 'START' }, textFit: { lines: 1, fits: true } });
  expect(byId.grp).toMatchObject({ kind: 'group', box: { x: 500, y: 10, width: 120, height: 40 } });
  expect(byId.logo).toMatchObject({ kind: 'image', groupId: 'grp', box: { x: 500, y: 10, width: 80, height: 40 } });
  expect(byId.mark).toMatchObject({ kind: 'shape', box: { x: 580, y: 10, width: 40, height: 40 }, fill: 'theme' });
  expect(byId.long.textFit.fits).toBe(false);
  expect(byId.tbl.cells).toEqual([{ row: 0, column: 0, text: 'Dim', fill: '#222222', alpha: 1 }]);
  const issues = (type: string) => result.issues.filter((i: any) => i.type === type);
  expect(issues('text_overflow').map((i: any) => i.ids[0])).toEqual(['long']);
  expect(issues('off_slide')).toEqual([expect.objectContaining({ severity: 'error', ids: ['spill'] })]);
  const low = issues('low_contrast');
  expect(low.find((i: any) => i.ids[0] === 'label')).toMatchObject({ background: '#F1F3F4', backgroundSource: 'card', textColor: '#FFFFFF' });
  expect(low.find((i: any) => i.ids[0] === 'tbl')).toMatchObject({ cell: { row: 0, column: 0 }, background: '#222222' });
  expect(low.some((i: any) => i.ids[0] === 'themed' || i.ids[0] === 'title')).toBe(false);
  const overlaps = issues('overlap').map((i: any) => i.ids.join('+'));
  expect(overlaps).toContain('card2+spill');
  expect(overlaps.some((o: string) => o.includes('label'))).toBe(false);
  expect(issues('empty_placeholder').map((i: any) => i.ids[0])).toEqual(['empty']);
  expect(issues('tight_margin').map((i: any) => i.ids[0])).toContain('empty');
  expect(issues('near_miss_alignment').some((i: any) => i.ids.join() === 'card,card2' || i.ids.join() === 'long,card2')).toBe(true);
  expect(issues('unequal_peers').some((i: any) => i.ids.includes('card') && i.ids.includes('card2'))).toBe(true);
  expect(Object.keys(result.issues[0])).toEqual(expect.arrayContaining(['severity', 'type', 'ids', 'message']));

  const tree = await harness(slidesTools, [slidePage, layoutDeck]).call('read_slide_layout', base);
  expect(tree).toBeInstanceOf(ToolContent);
  const lines = tree.content[0].text.split('\n');
  expect(lines[0]).toBe('slide p1 720x405 pt, background #0B2A4A, revision r9, 12 elements (z 0 = back)');
  expect(lines).toContain('z0 text title [TITLE] @40,32 640x60 "Quarterly review" 36pt bold #FFFFFF START lines 1');
  expect(lines.find((l: string) => l.startsWith('z3 text long'))).toContain('OVERFLOWS (needs ~');
  expect(lines.find((l: string) => l.includes(' logo '))).toStartWith('  z');
  expect(lines.some((l: string) => l.startsWith('error off_slide spill:'))).toBe(true);
});

test('read_slide_layout skips inherited backgrounds and only flags partial overlaps', async () => {
  const page = { objectId: 'p1', pageElements: [
    element('bg', 0, 0, 720, 405, { shape: { shapeType: 'RECTANGLE', shapeProperties: fill('#FFFFFF') } }),
    box('t', 40, 40, 200, 40, { text: text('Readable', { ...size(14), ...color('#202124') }) }),
    box('a', 300, 40, 100, 100), box('b', 380, 100, 100, 100),
  ] };
  const result = await harness(slidesTools, [page, { pageSize }]).call('read_slide_layout', { ...base, format: 'json' });
  expect(result.background).toBe('inherited');
  expect(result.issues.filter((i: any) => i.type === 'overlap').map((i: any) => i.ids)).toEqual([['a', 'b']]);
  expect(result.issues.some((i: any) => i.type === 'low_contrast')).toBe(false);
});
