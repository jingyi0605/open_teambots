import { blend, contrast, isHex, isLarge, minimum, nearestPassing, ratioText } from './contrast';
import { contains, intersection, round, type Box } from './geometry';

export type TextStyle = { color: string; size: number; bold: boolean };
export type TextFit = { lines: number; height: number; boxHeight: number; fits: boolean };
/** fill: "#RRGGBB", "none", "theme", "inherited" or "image" (opaque but unknown color). */
export type LintElement = {
  objectId: string; kind: string; z: number; box: Box; groupId?: string; shapeType?: string; placeholder?: string;
  fill?: string; alpha?: number; text?: string; styles?: TextStyle[]; textFit?: TextFit;
  cells?: Array<{ row: number; column: number; text: string; fill?: string; alpha?: number; styles?: TextStyle[] }>;
};
export type Issue = { severity: 'error' | 'warn' | 'info'; type: string; ids: string[]; message: string; [key: string]: unknown };
const SEVERITY: Record<string, Issue['severity']> = { off_slide: 'error', text_overflow: 'error', overlap: 'warn', low_contrast: 'warn', tight_margin: 'info', near_miss_alignment: 'info', unequal_peers: 'info', empty_placeholder: 'info' };
const issue = (type: string, ids: string[], message: string, extra: Record<string, unknown> = {}): Issue => ({ severity: SEVERITY[type]!, type, ids, message, ...extra });
const leaf = (e: LintElement) => e.kind !== 'group' && e.kind !== 'line';
const n = (v: number) => round(v);
const inside = (x: number, y: number, b: Box) => x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height;

/** The color actually rendered behind a point: the topmost filled element under it, else the slide background. */
export function fillBehind(z: number, x: number, y: number, all: LintElement[], background: string): { color: string; source: string } | undefined {
  const below = all.filter(e => e.z < z && leaf(e) && e.kind !== 'table' && inside(x, y, e.box)).sort((a, b) => b.z - a.z);
  for (const e of below) {
    if (!e.fill || e.fill === 'none') continue;
    if (!isHex(e.fill)) return undefined;
    if ((e.alpha ?? 1) < 1) { const under = fillBehind(e.z, x, y, all, background); return under && { color: blend(e.fill, under.color, e.alpha!), source: e.objectId }; }
    return { color: e.fill, source: e.objectId };
  }
  return isHex(background) ? { color: background, source: 'slide background' } : undefined;
}
const surfaceOf = (fill: string | undefined, alpha: number | undefined, behind: () => { color: string; source: string } | undefined, source: string) => {
  if (!fill || fill === 'none') return behind();
  if (!isHex(fill)) return undefined;
  if ((alpha ?? 1) < 1) { const under = behind(); return under && { color: blend(fill, under.color, alpha!), source }; }
  return { color: fill, source };
};
function contrastIssue(id: string, styles: TextStyle[] | undefined, surface: { color: string; source: string } | undefined, label = id): Issue | undefined {
  if (!surface) return;
  let worst: { style: TextStyle; ratio: number; required: number } | undefined;
  for (const style of styles ?? []) {
    if (!isHex(style.color)) continue;
    const ratio = contrast(style.color, surface.color), required = minimum(isLarge(style.size, style.bold));
    if (ratio < required && (!worst || ratio / required < worst.ratio / worst.required)) worst = { style, ratio, required };
  }
  if (!worst) return;
  const fix = nearestPassing(worst.style.color, surface.color, worst.required);
  const behind = surface.source === 'slide background' ? 'the slide background' : surface.source === id ? 'its own fill' : `the fill of ${surface.source}`;
  return issue('low_contrast', [id], `${label}: text ${worst.style.color} (${worst.style.size} pt${worst.style.bold ? ' bold' : ''}) on ${surface.color} (${behind}) is ${ratioText(worst.ratio)}, needs ${worst.required}:1${fix ? `; use ${fix.color} (${ratioText(fix.ratio)})` : ''}`,
    { ratio: Math.floor(worst.ratio * 100) / 100, required: worst.required, textColor: worst.style.color, background: surface.color, backgroundSource: surface.source, ...(fix ? { suggestion: fix.color } : {}) });
}

/** Deterministic layout lints. scope "plan" limits them to what compose_slide reports on its plan. */
export function lint(elements: LintElement[], slide: { width: number; height: number }, background: string, scope: 'plan' | 'full' = 'full'): Issue[] {
  const issues: Issue[] = [];
  const leaves = elements.filter(leaf);
  for (const e of elements) {
    if (e.kind === 'group') continue;
    const b = e.box, out = [b.x < -0.5 && `${n(-b.x)} pt past the left edge`, b.y < -0.5 && `${n(-b.y)} pt past the top edge`, b.x + b.width > slide.width + 0.5 && `${n(b.x + b.width - slide.width)} pt past the right edge`, b.y + b.height > slide.height + 0.5 && `${n(b.y + b.height - slide.height)} pt past the bottom edge`].filter(Boolean);
    if (out.length) issues.push(issue('off_slide', [e.objectId], `${e.objectId} extends ${out.join(', ')} of the ${n(slide.width)}x${n(slide.height)} slide`));
    if (e.textFit && !e.textFit.fits) issues.push(issue('text_overflow', [e.objectId], `${e.objectId}: text needs ~${n(e.textFit.height)} pt (${e.textFit.lines} lines) but the box is ${n(e.textFit.boxHeight)} pt tall; shorten it, shrink the font, or enlarge the box`, { neededHeight: n(e.textFit.height), boxHeight: n(e.textFit.boxHeight), lines: e.textFit.lines }));
    const center = [e.box.x + e.box.width / 2, e.box.y + e.box.height / 2] as const;
    const low = contrastIssue(e.objectId, e.styles, surfaceOf(e.fill, e.alpha, () => fillBehind(e.z, center[0], center[1], elements, background), e.objectId));
    if (low) issues.push(low);
    for (const cell of e.cells ?? []) {
      const cellIssue = contrastIssue(e.objectId, cell.styles, surfaceOf(cell.fill, cell.alpha, () => fillBehind(e.z, center[0], center[1], elements, background), `${e.objectId}[${cell.row},${cell.column}]`), `${e.objectId} cell [${cell.row},${cell.column}]`);
      if (cellIssue) issues.push({ ...cellIssue, cell: { row: cell.row, column: cell.column } });
    }
  }
  for (let i = 0; i < leaves.length; i++) for (let j = i + 1; j < leaves.length; j++) {
    const a = leaves[i]!, b = leaves[j]!;
    if (a.groupId && a.groupId === b.groupId) continue;
    const overlap = intersection(a.box, b.box);
    if (overlap.width > 1 && overlap.height > 1 && !contains(a.box, b.box) && !contains(b.box, a.box))
      issues.push(issue('overlap', [a.objectId, b.objectId], `${a.objectId} and ${b.objectId} partially overlap by ${n(overlap.width)}x${n(overlap.height)} pt`));
  }
  if (scope === 'plan') return issues;
  for (const e of leaves) {
    if (e.placeholder && !e.text?.trim() && e.kind !== 'image') issues.push(issue('empty_placeholder', [e.objectId], `${e.objectId} is an empty ${e.placeholder} placeholder (shows "Click to add" in the editor); fill it with set_shape_text or delete_object it`));
    const b = e.box, gaps: Array<[string, number]> = [['left', b.x], ['top', b.y], ['right', slide.width - b.x - b.width], ['bottom', slide.height - b.y - b.height]];
    const tight = gaps.filter(([, d]) => d > 0.5 && d < 18);
    if (tight.length) issues.push(issue('tight_margin', [e.objectId], `${e.objectId} sits ${tight.map(([side, d]) => `${n(d)} pt from the ${side} edge`).join(', ')} (keep >= 18 pt, or make it full-bleed)`));
  }
  const edges: Array<[string, (b: Box) => number]> = [['left', b => b.x], ['right', b => b.x + b.width], ['top', b => b.y], ['bottom', b => b.y + b.height], ['horizontal center', b => b.x + b.width / 2], ['vertical center', b => b.y + b.height / 2]];
  for (let i = 0; i < leaves.length; i++) for (let j = i + 1; j < leaves.length; j++) {
    const a = leaves[i]!, b = leaves[j]!;
    if (contains(a.box, b.box) || contains(b.box, a.box)) continue;
    const near = edges.map(([name, edge]) => [name, Math.abs(edge(a.box) - edge(b.box))] as const).filter(([, d]) => d >= 1 && d <= 6);
    if (near.length) issues.push(issue('near_miss_alignment', [a.objectId, b.objectId], `${a.objectId} and ${b.objectId}: ${near.map(([name, d]) => `${name} edges ${n(d)} pt apart`).join(', ')}; align them exactly`));
  }
  const peers = (axis: 'row' | 'column') => {
    const key = (e: LintElement) => `${e.kind}:${e.shapeType ?? ''}`;
    const groups = new Map<string, LintElement[][]>();
    const candidates = leaves.filter(e => e.kind !== 'table').sort((a, b) => axis === 'row' ? a.box.y - b.box.y : a.box.x - b.box.x);
    for (const e of candidates) {
      const lists = groups.get(key(e)) ?? [];
      const last = lists.at(-1), start = (x: LintElement) => axis === 'row' ? x.box.y : x.box.x;
      if (last && start(e) - start(last[0]!) <= 6) last.push(e); else lists.push([e]);
      groups.set(key(e), lists);
    }
    for (const lists of groups.values()) for (const list of lists) {
      if (list.length < (list[0]!.kind === 'text' ? 3 : 2)) continue;
      const widths = list.map(e => e.box.width), heights = list.map(e => e.box.height);
      const dw = Math.max(...widths) - Math.min(...widths), dh = Math.max(...heights) - Math.min(...heights);
      if (dw > 2 || dh > 2) issues.push(issue('unequal_peers', list.map(e => e.objectId), `${list.length} ${list[0]!.kind} elements share a ${axis} but differ in size (${list.map(e => `${n(e.box.width)}x${n(e.box.height)}`).join(', ')}); make peers equal (insert_grid)`));
    }
  };
  peers('row'); peers('column');
  return issues;
}
