import { contrast, isHex, isLarge, minimum, mix, nearestPassing, normalizeHex, onColor, ratioText } from './contrast';
import { placement, round, roundBox, type Box } from './geometry';
import type { LintElement } from './lint';
import { createShape, defined, insertText, paragraphStyle, shapeStyle, textStyle } from './requests';
import { INSET, measure, paragraphsOf } from './text';

export type Role = 'display' | 'h1' | 'h2' | 'body' | 'caption' | 'kpi';
export type Size = number | { flex: number };
export type Edges = [number, number, number, number];
type Justify = 'start' | 'center' | 'end' | 'space-between' | 'space-evenly';
export type TextNode = { kind: 'text'; text: string; role?: Role; color?: string; align?: 'start' | 'center' | 'end'; bold?: boolean; fontSize?: number; fit?: 'wrap' | 'shrink'; bullets?: boolean; numbered?: boolean; size?: Size };
export type CardNode = { kind: 'card'; children: TextNode[]; surface?: string; padding?: number | Edges; gap?: number; justify?: Justify; shape?: string; size?: Size };
export type ImageNode = { kind: 'image'; url: string; size?: Size; alt?: string };
export type SpacerNode = { kind: 'spacer'; size?: Size };
export type StackNode = { kind: 'stack'; direction: 'row' | 'column'; gap?: number; justify?: Justify; size?: Size; children: LayoutNode[]; padding?: Edges };
export type GridNode = { kind: 'grid'; columns: number; rows?: number; gap?: number; size?: Size; children: LayoutNode[]; padding?: Edges };
export type LayoutNode = TextNode | CardNode | ImageNode | SpacerNode | StackNode | GridNode;

const PALETTE_ROLES = ['background', 'surface', 'primary', 'onBackground', 'onSurface', 'onPrimary', 'textSecondary'] as const;
type PaletteRole = typeof PALETTE_ROLES[number];
const SCALE: Record<Role, number> = { display: 44, h1: 28, h2: 22, body: 16, caption: 12, kpi: 36 };
const BOLD_ROLES = new Set(['display', 'h1', 'kpi']);
const ON: Record<string, PaletteRole> = { background: 'onBackground', surface: 'onSurface', primary: 'onPrimary' };
// Defaults: stack/grid gap 16, card padding 16 and gap 8 (the descriptions leave them open).
export const DEFAULTS = { gap: 16, cardPadding: 16, cardGap: 8, margin: 48 };
/** Measured text widths are padded 5% so a box sized by the estimate rarely wraps one line more when rendered. */
const SAFETY = 1.05;

export type Theme = ReturnType<typeof resolveTheme>;
/** Palette roles with defaults (navy dark) and on-colors / secondary text derived to pass WCAG AA when omitted. */
export function resolveTheme(theme: any = {}, backgroundOverride?: string) {
  const given: Partial<Record<PaletteRole, string>> = Object.fromEntries(Object.entries(theme.palette ?? {}).map(([k, v]) => [k, normalizeHex(String(v))]));
  if (backgroundOverride) given.background = normalizeHex(backgroundOverride);
  // The default palette is keyed on its navy background, so naming that background keeps its surface/accent/secondary.
  const background = given.background ?? '#0B2A4A', custom = background !== '#0B2A4A';
  const dark = contrast('#FFFFFF', background) >= contrast('#000000', background);
  const surface = given.surface ?? (custom ? mix(background, dark ? '#FFFFFF' : '#000000', dark ? 0.12 : 0.05) : '#1E4976');
  const primary = given.primary ?? (custom && !dark ? '#0B57D0' : '#4FC3F7');
  const onBackground = given.onBackground ?? onColor(background);
  let textSecondary = given.textSecondary ?? (!custom && !given.surface ? '#B8CCE0' : undefined);
  for (let t = 40; !textSecondary && t >= 0; t -= 5) {
    const candidate = mix(onBackground, background, t / 100);
    if (contrast(candidate, background) >= 4.5 && contrast(candidate, surface) >= 4.5) textSecondary = candidate;
  }
  const palette: Record<PaletteRole, string> = { background, surface, primary, onBackground, onSurface: given.onSurface ?? onColor(surface), onPrimary: given.onPrimary ?? onColor(primary), textSecondary: textSecondary ?? onBackground };
  return { palette, given, family: theme.type?.family as string | undefined, scale: { ...SCALE, ...(theme.type?.scale ?? {}) } as Record<Role, number> };
}

type Ctx = { fill: string; fillName: string; inCard: boolean };
type ColorChoice = { hex: string; name: string; given: boolean };
export type Placed =
  | { kind: 'card'; id: string; box: Box; fill: string; fillName: string; shape: string }
  | { kind: 'image'; id: string; box: Box; url: string; alt?: string }
  | { kind: 'text'; id: string; box: Box; node: TextNode; size: number; bold: boolean; color: ColorChoice; align: string; ctx: Ctx; lines: number; needed: number; fits: boolean };
export const edges = (p: number | Edges | undefined, fallback: number): Edges => Array.isArray(p) ? p : [p ?? fallback, p ?? fallback, p ?? fallback, p ?? fallback];
const inset = (b: Box, [top, right, bottom, left]: Edges): Box => ({ x: b.x + left, y: b.y + top, width: Math.max(0, b.width - left - right), height: Math.max(0, b.height - top - bottom) });

/** Lay out a compose_slide tree inside the slide minus the frame (margin), in paint order. */
export function composePlan(root: LayoutNode, slide: { width: number; height: number }, frame: Edges, theme: Theme, id: (kind: string) => string = kind => `${kind}_${crypto.randomUUID().slice(0, 8)}`) {
  const placed: Placed[] = [];
  const sizeOf = (n: TextNode) => n.fontSize ?? theme.scale[n.role ?? 'body'] ?? 16;
  const boldOf = (n: TextNode) => n.bold ?? BOLD_ROLES.has(n.role ?? 'body');
  const textHeight = (n: TextNode, width: number, size = sizeOf(n)) => {
    const m = measure(paragraphsOf(n.text, size, boldOf(n), theme.family, Boolean(n.bullets || n.numbered)), width, SAFETY);
    return { lines: m.lines, height: m.height + 2 * INSET };
  };
  const cardHeight = (n: CardNode, width: number) => {
    const p = edges(n.padding, DEFAULTS.cardPadding), inner = width - p[1] - p[3];
    return p[0] + p[2] + n.children.reduce((sum, c) => sum + textHeight(c, inner).height, 0) + (n.children.length - 1) * (n.gap ?? DEFAULTS.cardGap);
  };
  const intrinsic = (n: LayoutNode, width: number) => n.kind === 'text' ? textHeight(n, width).height : n.kind === 'card' ? cardHeight(n, width) : undefined;
  const color = (value: string | undefined, ctx: Ctx): ColorChoice => {
    if (!value) { const role = ON[ctx.fillName]; return role ? { hex: theme.palette[role], name: role, given: Boolean(theme.given[role]) } : { hex: onColor(ctx.fill), name: 'derived', given: false }; }
    if (isHex(value)) return { hex: normalizeHex(value), name: normalizeHex(value), given: true };
    const hex = theme.palette[value as PaletteRole];
    if (!hex) throw new Error(`Unknown color role "${value}"; use one of ${PALETTE_ROLES.join(', ')} or #RRGGBB`);
    return { hex, name: value, given: true };
  };
  const surface = (value: string | undefined): { hex: string; name: string } => {
    const v = value ?? 'surface';
    if (isHex(v)) return { hex: normalizeHex(v), name: normalizeHex(v) };
    if (!['surface', 'primary', 'background'].includes(v)) throw new Error(`Card surface "${v}" must be surface, primary, background or #RRGGBB`);
    return { hex: theme.palette[v as PaletteRole], name: v };
  };

  /** Main-axis sizes: fixed points, flex shares, or (in a column) measured text/card heights that compress when space runs out. */
  const arrange = (children: LayoutNode[], box: Box, direction: 'row' | 'column', gap: number, justify: Justify = 'start') => {
    const main = direction === 'row' ? box.width : box.height;
    const specs = children.map(c => {
      if (typeof c.size === 'number') return { fixed: c.size };
      if (c.size && typeof c.size === 'object') return { flex: c.size.flex };
      const measured = direction === 'column' ? intrinsic(c, box.width) : undefined;
      return measured !== undefined ? { measured, shrink: c.kind === 'text' && c.fit === 'shrink' } : { flex: 1 };
    });
    const sizes = specs.map(s => s.fixed ?? s.measured ?? 0);
    const gaps = gap * Math.max(0, children.length - 1);
    let free = main - gaps - sizes.reduce((a, b) => a + b, 0);
    for (const shrinkOnly of [true, false]) {
      if (free >= 0) break;
      const items = specs.map((s, i) => ({ s, i })).filter(({ s }) => s.measured !== undefined && (!shrinkOnly || s.shrink));
      const room = items.reduce((t, { i }) => t + sizes[i]! * (shrinkOnly ? 0.6 : 1), 0);
      if (!room) continue;
      const take = Math.min(-free, room);
      for (const { i } of items) sizes[i]! -= take * sizes[i]! * (shrinkOnly ? 0.6 : 1) / room;
      free += take;
    }
    const flex = specs.reduce((t, s) => t + (s.flex ?? 0), 0);
    if (free > 0 && flex > 0) { specs.forEach((s, i) => { if (s.flex) sizes[i] = free * s.flex / flex; }); free = 0; }
    let offset = 0, spacing = gap;
    if (free > 0) {
      if (justify === 'center') offset = free / 2;
      else if (justify === 'end') offset = free;
      else if (justify === 'space-between' && children.length > 1) spacing = gap + free / (children.length - 1);
      else if (justify === 'space-evenly') { offset = free / (children.length + 1); spacing = gap + offset; }
    }
    let cursor = (direction === 'row' ? box.x : box.y) + offset;
    return sizes.map(size => {
      const b = direction === 'row' ? { x: cursor, y: box.y, width: size, height: box.height } : { x: box.x, y: cursor, width: box.width, height: size };
      cursor += size + spacing;
      return b;
    });
  };
  const placeText = (n: TextNode, box: Box, ctx: Ctx) => {
    let size = sizeOf(n), m = textHeight(n, box.width, size);
    if (n.fit === 'shrink') while (m.height > box.height + 0.5 && size > 6) { size = Math.max(6, size - 0.5); m = textHeight(n, box.width, size); }
    placed.push({ kind: 'text', id: id('text'), box, node: n, size, bold: boldOf(n), color: color(n.color, ctx), align: (n.align ?? (ctx.inCard ? 'center' : 'start')).toUpperCase(), ctx, lines: m.lines, needed: m.height, fits: m.height <= box.height + 0.5 });
  };
  const place = (n: LayoutNode, box: Box, ctx: Ctx, path: string) => {
    if (box.width < 4 || box.height < 4) { if (n.kind !== 'spacer') throw new Error(`No room for the ${n.kind} at ${path} (${round(box.width)}x${round(box.height)} pt); reduce fixed sizes, gaps or margins, or shorten text`); return; }
    if (n.kind === 'text') return placeText(n, box, ctx);
    if (n.kind === 'image') { placed.push({ kind: 'image', id: id('image'), box, url: n.url, ...(n.alt ? { alt: n.alt } : {}) }); return; }
    if (n.kind === 'spacer') return;
    if (n.kind === 'card') {
      const fill = surface(n.surface);
      placed.push({ kind: 'card', id: id('card'), box, fill: fill.hex, fillName: fill.name, shape: n.shape ?? 'ROUND_RECTANGLE' });
      const inner = inset(box, edges(n.padding, DEFAULTS.cardPadding));
      arrange(n.children, inner, 'column', n.gap ?? DEFAULTS.cardGap, n.justify ?? 'center').forEach((b, i) => placeText(n.children[i]!, b, { fill: fill.hex, fillName: fill.name, inCard: true }));
      return;
    }
    const inner = inset(box, n.padding ?? [0, 0, 0, 0]);
    if (n.kind === 'stack') { arrange(n.children, inner, n.direction, n.gap ?? DEFAULTS.gap, n.justify).forEach((b, i) => place(n.children[i]!, b, ctx, `${path}.children[${i}]`)); return; }
    const columns = n.columns, rows = n.rows ?? Math.ceil(n.children.length / columns), gap = n.gap ?? DEFAULTS.gap;
    if (n.children.length > rows * columns) throw new Error(`Grid at ${path} has ${n.children.length} children but only ${rows}x${columns} cells`);
    const w = (inner.width - gap * (columns - 1)) / columns, h = (inner.height - gap * (rows - 1)) / rows;
    n.children.forEach((c, i) => place(c, { x: inner.x + (i % columns) * (w + gap), y: inner.y + Math.floor(i / columns) * (h + gap), width: w, height: h }, ctx, `${path}.children[${i}]`));
  };
  const rootBox = inset({ x: 0, y: 0, width: slide.width, height: slide.height }, frame);
  place(root, rootBox, { fill: theme.palette.background, fillName: 'background', inCard: false }, 'root');

  const refused = placed.flatMap(p => {
    if (p.kind !== 'text') return [];
    const ratio = contrast(p.color.hex, p.ctx.fill), required = minimum(isLarge(p.size, p.bold));
    if (ratio >= required) return [];
    const fix = nearestPassing(p.color.hex, p.ctx.fill, required);
    const label = p.node.text.length > 30 ? `${p.node.text.slice(0, 29)}…` : p.node.text;
    return [`text ${JSON.stringify(label)} in ${p.color.name === p.color.hex ? p.color.hex : `${p.color.name} ${p.color.hex}`} on ${p.ctx.fillName === p.ctx.fill ? p.ctx.fill : `${p.ctx.fillName} ${p.ctx.fill}`} is ${ratioText(ratio)}, needs ${required}:1${fix ? ` (use ${fix.color}, ${ratioText(fix.ratio)})` : ''}`];
  });
  if (refused.length) throw new Error(`Refused before writing: ${refused.length} text/fill pair(s) fail WCAG AA contrast: ${refused.join('; ')}. Change the color, the palette, or the card surface.`);
  return { placed, rootBox };
}

/** batchUpdate requests creating a plan's elements in paint order. */
export function planRequests(pageObjectId: string, placed: Placed[], theme: Theme) {
  return placed.flatMap((p): unknown[] => {
    if (p.kind === 'card') return defined([createShape(p.id, p.shape, pageObjectId, p.box), shapeStyle(p.id, { fill: p.fill, outline: null })]);
    if (p.kind === 'image') return defined([{ createImage: { objectId: p.id, url: p.url, elementProperties: placement(pageObjectId, p.box) } }, p.alt && { updatePageElementAltText: { objectId: p.id, description: p.alt } }]);
    const bullets = p.node.bullets || p.node.numbered;
    return defined([
      createShape(p.id, 'TEXT_BOX', pageObjectId, p.box), insertText(p.id, p.node.text),
      textStyle(p.id, { fontSize: p.size, bold: p.bold, color: p.color.hex, fontFamily: theme.family }),
      paragraphStyle(p.id, { alignment: p.align, lineSpacing: 100, spaceAbove: 0, spaceBelow: 0 }),
      bullets && { createParagraphBullets: { objectId: p.id, textRange: { type: 'ALL' }, bulletPreset: p.node.numbered ? 'NUMBERED_DIGIT_ALPHA_ROMAN' : 'BULLET_DISC_CIRCLE_SQUARE' } },
    ]);
  });
}
/** The plan as lintable elements (z = paint order). */
export const planElements = (placed: Placed[]): LintElement[] => placed.map((p, z) =>
  p.kind === 'card' ? { objectId: p.id, kind: 'shape', shapeType: p.shape, z, box: p.box, fill: p.fill }
    : p.kind === 'image' ? { objectId: p.id, kind: 'image', z, box: p.box, fill: 'image' }
      : { objectId: p.id, kind: 'text', z, box: p.box, fill: 'none', text: p.node.text, styles: [{ color: p.color.hex, size: p.size, bold: p.bold }], textFit: { lines: p.lines, height: round(p.needed), boxHeight: round(p.box.height), fits: p.fits } });
/** What compose_slide returns per element. */
export const planView = (placed: Placed[]) => placed.map(p =>
  p.kind === 'card' ? { objectId: p.id, kind: 'card', box: roundBox(p.box), fill: p.fill, surface: p.fillName }
    : p.kind === 'image' ? { objectId: p.id, kind: 'image', box: roundBox(p.box), url: p.url, fit: 'contain (centered in the box)' }
      : { objectId: p.id, kind: 'text', box: roundBox(p.box), role: p.node.role ?? 'body', text: p.node.text.length > 80 ? `${p.node.text.slice(0, 79)}…` : p.node.text, fontSize: p.size, bold: p.bold, color: p.color.hex, colorRole: p.color.name, align: p.align, lines: p.lines, fits: p.fits });

/** CSS-grid-like sparse auto-placement in row-major order with column/row spans. */
export function gridPlacement(cells: Array<{ colSpan?: number; rowSpan?: number }>, columns: number, rows?: number) {
  const taken = new Set<string>();
  const free = (r: number, c: number, cs: number, rs: number) => { for (let i = r; i < r + rs; i++) for (let j = c; j < c + cs; j++) if (taken.has(`${i},${j}`)) return false; return true; };
  let r = 0, c = 0;
  const placements = cells.map((cell, index) => {
    const cs = cell.colSpan ?? 1, rs = cell.rowSpan ?? 1;
    if (cs > columns) throw new Error(`Cell ${index} spans ${cs} columns but the grid has ${columns}`);
    while (c + cs > columns || !free(r, c, cs, rs)) { c++; if (c + cs > columns) { c = 0; r++; } }
    for (let i = r; i < r + rs; i++) for (let j = c; j < c + cs; j++) taken.add(`${i},${j}`);
    const placement = { row: r, column: c, colSpan: cs, rowSpan: rs };
    c += cs; if (c >= columns) { c = 0; r++; }
    return placement;
  });
  const needed = Math.max(1, ...placements.map(p => p.row + p.rowSpan));
  if (rows !== undefined && needed > rows) throw new Error(`The cells need ${needed} rows at ${columns} columns, but rows is ${rows}; raise rows or columns, or remove cells`);
  return { placements, rows: rows ?? needed };
}
