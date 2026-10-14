import { opaque } from './contrast';
import { dim, flatten, rotation, roundBox, round, type Box } from './geometry';
import { lint, type Issue, type LintElement, type TextStyle } from './lint';
import { DEFAULT_SIZE, INSET, measure, type Paragraph } from './text';

type Inherited = { fontSize?: number; bold?: boolean; color?: string; family?: string; fill?: any };
const firstRunStyle = (shape: any) => shape?.text?.textElements?.find((t: any) => t.textRun)?.textRun?.style ?? {};
/** Text and fill a placeholder inherits through its layout and master placeholders (unset fields inherit). */
function inherited(shape: any, parents: Map<string, any>, depth = 0): Inherited {
  const parent = shape?.placeholder?.parentObjectId && parents.get(shape.placeholder.parentObjectId);
  if (!parent?.shape || depth > 4) return {};
  const style = firstRunStyle(parent.shape), up = inherited(parent.shape, parents, depth + 1);
  const fill = parent.shape.shapeProperties?.shapeBackgroundFill;
  return {
    fontSize: style.fontSize ? dim(style.fontSize) : up.fontSize, bold: style.bold ?? up.bold,
    color: opaque(style.foregroundColor?.opaqueColor) ?? up.color, family: style.fontFamily ?? up.family,
    fill: fill && fill.propertyState !== 'INHERIT' ? fill : up.fill,
  };
}
/** A fill as "#RRGGBB" | "none" | "theme", with alpha; a placeholder whose chain sets no fill is transparent. */
function fillOf(fill: any, placeholder: boolean, parentFill: any): { fill: string; alpha?: number } {
  if (!fill || fill.propertyState === 'INHERIT') return placeholder && parentFill ? fillOf(parentFill, false, undefined) : { fill: 'none' };
  if (fill.propertyState === 'NOT_RENDERED') return { fill: 'none' };
  const color = opaque(fill.solidFill?.color);
  return color ? { fill: color, alpha: fill.solidFill.alpha ?? 1 } : { fill: 'none' };
}
const outlineOf = (outline: any) => !outline ? undefined : outline.propertyState === 'NOT_RENDERED' ? 'none' : outline.propertyState === 'INHERIT' ? 'inherited' : opaque(outline.outlineFill?.solidFill?.color);
export const plainText = (text: any) => (text?.textElements ?? []).map((t: any) => t.textRun?.content ?? t.autoText?.content ?? '').join('').replace(/\n$/, '');

/** Paragraphs (for wrap estimation), distinct run styles (for contrast) and the leading style of a Slides text body. */
export function readText(text: any, inherit: Inherited = {}, fontScale = 1) {
  const paragraphs: Paragraph[] = [], styles = new Map<string, TextStyle>();
  let current: Paragraph | undefined, lead: any, align: string | undefined;
  for (const element of text?.textElements ?? []) {
    if (element.paragraphMarker) {
      const s = element.paragraphMarker.style ?? {};
      align ??= s.alignment;
      current = { runs: [], lineSpacing: s.lineSpacing, spaceAbove: dim(s.spaceAbove), spaceBelow: dim(s.spaceBelow), indentStart: s.indentStart ? dim(s.indentStart) : element.paragraphMarker.bullet ? 18 : 0 };
      paragraphs.push(current); continue;
    }
    const run = element.textRun ?? element.autoText;
    if (!run) continue;
    if (!current) { current = { runs: [] }; paragraphs.push(current); }
    const s = run.style ?? {};
    const style = { size: round((s.fontSize ? dim(s.fontSize) : inherit.fontSize ?? DEFAULT_SIZE) * fontScale), bold: s.bold ?? inherit.bold ?? false, color: opaque(s.foregroundColor?.opaqueColor) ?? inherit.color ?? 'theme', family: s.fontFamily ?? inherit.family };
    const content = String(run.content ?? '').replace(/\n$/, '');
    current.runs.push({ text: content, size: style.size, bold: style.bold, family: style.family });
    if (content.trim()) { lead ??= style; styles.set(`${style.color}|${style.size}|${style.bold}`, { color: style.color, size: style.size, bold: style.bold }); }
  }
  return { paragraphs, styles: [...styles.values()], lead, align };
}

export type Inspected = LintElement & Record<string, unknown>;
/** Every element of a page with absolute boxes in points, paint order, fills, text styles and wrap estimates. */
export function inspectPage(page: any, parents: Map<string, any> = new Map()) {
  const elements: Inspected[] = [];
  flatten(page.pageElements).forEach(({ element: e, matrix, box, groupId }, z) => {
    const base: Inspected = { objectId: e.objectId, z, kind: 'other', box: roundBox(box), ...(groupId ? { groupId } : {}) };
    const angle = rotation(matrix);
    if (angle) base.rotation = angle;
    if (e.title) base.title = e.title;
    if (e.description) base.description = e.description;
    if (e.shape) {
      const shape = e.shape, props = shape.shapeProperties ?? {}, inherit = inherited(shape, parents);
      Object.assign(base, { kind: shape.shapeType === 'TEXT_BOX' ? 'text' : 'shape', shapeType: shape.shapeType }, fillOf(props.shapeBackgroundFill, Boolean(shape.placeholder), inherit.fill));
      if (shape.placeholder) base.placeholder = shape.placeholder.type;
      const outline = outlineOf(props.outline);
      if (outline) base.outline = outline;
      if (props.autofit?.autofitType && props.autofit.autofitType !== 'NONE') base.autofit = props.autofit.autofitType;
      if (props.contentAlignment) base.verticalAlign = props.contentAlignment;
      const content = plainText(shape.text);
      base.text = content;
      if (shape.text) {
        const read = readText(shape.text, inherit, props.autofit?.fontScale ?? 1);
        base.styles = read.styles;
        if (read.lead) base.textStyle = { fontSize: read.lead.size, bold: read.lead.bold, color: read.lead.color, align: read.align ?? 'START', ...(read.lead.family ? { fontFamily: read.lead.family } : {}) };
        if (content.length) {
          // Wrap against the element's own (unrotated) rendered size, not its bounding box.
          const width = dim(e.size?.width) * Math.hypot(matrix[0], matrix[1]), boxHeight = dim(e.size?.height) * Math.hypot(matrix[2], matrix[3]);
          const m = measure(read.paragraphs, width), height = m.height + 2 * INSET;
          base.textFit = { lines: m.lines, height: round(height), boxHeight: round(boxHeight), fits: height <= boxHeight + 2 };
        }
      }
    } else if (e.image) Object.assign(base, { kind: 'image', fill: 'image' });
    else if (e.line) Object.assign(base, { kind: 'line', lineCategory: e.line.lineCategory ?? e.line.lineType });
    else if (e.elementGroup) Object.assign(base, { kind: 'group', children: e.elementGroup.children?.length ?? 0 });
    else if (e.table) {
      const table = e.table;
      const cells = (table.tableRows ?? []).flatMap((row: any, r: number) => (row.tableCells ?? []).map((cell: any, c: number) => {
        const read = readText(cell.text), fill = fillOf(cell.tableCellProperties?.tableCellBackgroundFill, false, undefined);
        return { row: cell.location?.rowIndex ?? r, column: cell.location?.columnIndex ?? c, text: plainText(cell.text), ...(cell.tableCellProperties?.tableCellBackgroundFill ? fill : { fill: 'theme' }), styles: read.styles };
      }));
      Object.assign(base, { kind: 'table', rows: table.rows, columns: table.columns, cells });
    } else Object.assign(base, { kind: e.video ? 'video' : e.sheetsChart ? 'chart' : e.wordArt ? 'wordArt' : 'other' });
    elements.push(base);
  });
  return elements;
}
export function backgroundOf(page: any) {
  const fill = page?.pageProperties?.pageBackgroundFill;
  if (!fill || fill.propertyState === 'INHERIT' || fill.propertyState === 'NOT_RENDERED') return 'inherited';
  if (fill.stretchedPictureFill) return 'image';
  return opaque(fill.solidFill?.color) ?? 'inherited';
}

const view = (e: Inspected) => {
  const { styles, cells, ...rest } = e;
  return { ...rest, ...(cells ? { cells: cells.map(({ styles: _, ...cell }) => cell) } : {}) };
};
const quote = (text: string, max = 80) => JSON.stringify(text.length > max ? `${text.slice(0, max - 1)}…` : text);
const fmt = (b: Box) => `@${b.x},${b.y} ${b.width}x${b.height}`;
export function treeLine(e: Inspected, depth = 0) {
  const style = e.textStyle as any, fit = e.textFit;
  const parts = [`${'  '.repeat(depth)}z${e.z} ${e.kind} ${e.objectId}`];
  if (e.kind === 'shape' && e.shapeType) parts.push(e.shapeType);
  if (e.placeholder) parts.push(`[${e.placeholder}]`);
  parts.push(fmt(e.box));
  if (e.rotation) parts.push(`rot ${e.rotation}`);
  if (e.fill && !['none', 'image'].includes(e.fill)) parts.push(`fill ${e.fill}${(e.alpha ?? 1) < 1 ? ` alpha ${round(e.alpha!, 2)}` : ''}`);
  if (e.outline && e.outline !== 'none') parts.push(`outline ${e.outline}`);
  if (e.kind === 'table') parts.push(`${e.rows}x${e.columns}`, `cells ${(e.cells ?? []).filter(c => c.text).map(c => `[${c.row},${c.column}]${quote(c.text, 24)}`).join(' ') || '(empty)'}`);
  if (e.kind === 'group') parts.push(`${e.children} children`);
  if (e.text) parts.push(quote(e.text));
  else if (e.placeholder) parts.push('(empty)');
  if (style && e.text) parts.push(`${style.fontSize}pt${style.bold ? ' bold' : ''} ${style.color} ${style.align}${style.fontFamily ? ` ${style.fontFamily}` : ''}`);
  if (fit) parts.push(`lines ${fit.lines}${fit.fits ? '' : ` OVERFLOWS (needs ~${fit.height} pt, box ${fit.boxHeight} pt)`}`);
  if (e.title) parts.push(`alt ${quote(String(e.title), 40)}`);
  return parts.join(' ');
}
export function slideLayout(page: any, slide: { width: number; height: number }, parents: Map<string, any>, revisionId?: string) {
  const elements = inspectPage(page, parents), background = backgroundOf(page);
  const issues: Issue[] = lint(elements, slide, background);
  return { pageObjectId: page.objectId, revisionId: revisionId ?? page.revisionId ?? null, slide: { width: round(slide.width), height: round(slide.height) }, background, elements, issues, view: () => elements.map(view) };
}
export function formatTree(layout: ReturnType<typeof slideLayout>) {
  const depth = new Map<string, number>();
  const lines = [`slide ${layout.pageObjectId} ${layout.slide.width}x${layout.slide.height} pt, background ${layout.background}, revision ${layout.revisionId ?? 'unknown'}, ${layout.elements.length} elements (z 0 = back)`];
  for (const e of layout.elements) {
    const d = e.groupId ? (depth.get(e.groupId) ?? 0) + 1 : 0;
    depth.set(e.objectId, d);
    lines.push(treeLine(e, d));
  }
  lines.push(layout.issues.length ? `issues (${layout.issues.length}):` : 'issues: none');
  for (const i of layout.issues) lines.push(`${i.severity} ${i.type} ${i.ids.join(',')}: ${i.message}`);
  return lines.join('\n');
}
