/** Slides geometry: EMU/point conversion, affine transforms and absolute element boxes. */
export const EMU = 12700;
export type Box = { x: number; y: number; width: number; height: number };
/** [scaleX, shearY, shearX, scaleY, translateX(pt), translateY(pt)]: x' = a*x + c*y + e, y' = b*x + d*y + f. */
export type Affine = [number, number, number, number, number, number];
export const identity: Affine = [1, 0, 0, 1, 0, 0];

export const pt = (magnitude: number) => ({ magnitude: round(magnitude, 3), unit: 'PT' });
export const round = (value: number, digits = 1) => { const f = 10 ** digits; return Math.round(value * f) / f || 0; };
export const dim = (d: any): number => !d?.magnitude ? 0 : d.unit === 'PT' ? d.magnitude : d.magnitude / EMU;
export const pageSize = (presentation: any) => ({ width: dim(presentation?.pageSize?.width) || 720, height: dim(presentation?.pageSize?.height) || 405 });

// Protobuf JSON omits zero fields, so a present transform with a missing scale is a real 0 (e.g. a 90 degree rotation).
export const toAffine = (t: any): Affine => {
  if (!t) return identity;
  const unit = t.unit === 'PT' ? 1 : 1 / EMU;
  return [t.scaleX ?? 0, t.shearY ?? 0, t.shearX ?? 0, t.scaleY ?? 0, (t.translateX ?? 0) * unit, (t.translateY ?? 0) * unit];
};
export const multiply = (p: Affine, c: Affine): Affine => [
  p[0] * c[0] + p[2] * c[1], p[1] * c[0] + p[3] * c[1],
  p[0] * c[2] + p[2] * c[3], p[1] * c[2] + p[3] * c[3],
  p[0] * c[4] + p[2] * c[5] + p[4], p[1] * c[4] + p[3] * c[5] + p[5],
];
export const apply = (m: Affine, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
export const boxOf = (m: Affine, width: number, height: number): Box => {
  const corners = [apply(m, 0, 0), apply(m, width, 0), apply(m, 0, height), apply(m, width, height)];
  const xs = corners.map(c => c[0]), ys = corners.map(c => c[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
};
export const union = (boxes: Box[]): Box | undefined => {
  if (!boxes.length) return undefined;
  const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
  return { x, y, width: Math.max(...boxes.map(b => b.x + b.width)) - x, height: Math.max(...boxes.map(b => b.y + b.height)) - y };
};
export const rotation = (m: Affine) => round(Math.atan2(m[1], m[0]) * 180 / Math.PI, 1);
export const roundBox = (b: Box): Box => ({ x: round(b.x), y: round(b.y), width: round(b.width), height: round(b.height) });
export const contains = (outer: Box, inner: Box, tolerance = 1) =>
  inner.x >= outer.x - tolerance && inner.y >= outer.y - tolerance && inner.x + inner.width <= outer.x + outer.width + tolerance && inner.y + inner.height <= outer.y + outer.height + tolerance;
export const intersection = (a: Box, b: Box) => ({ width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x), height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) });

/** Element properties for a new element at a box in points (identity scale, so size is the rendered size). */
export const placement = (pageObjectId: string, box: Box) => ({
  pageObjectId,
  size: { width: pt(Math.max(box.width, 0.01)), height: pt(Math.max(box.height, 0.01)) },
  transform: { scaleX: 1, scaleY: 1, translateX: round(box.x, 3), translateY: round(box.y, 3), unit: 'PT' },
});

export type Flat = { element: any; matrix: Affine; box: Box; depth: number; groupId?: string; parent?: Affine };
/** Flatten page elements depth-first in paint order; a child's absolute transform is its group's transform pre-concatenated. */
export function flatten(elements: any[] = [], parent: Affine = identity, depth = 0, groupId?: string, out: Flat[] = []): Flat[] {
  for (const element of elements) {
    const matrix = multiply(parent, toAffine(element.transform));
    const entry: Flat = { element, matrix, depth, groupId, parent, box: boxOf(matrix, dim(element.size?.width), dim(element.size?.height)) };
    out.push(entry);
    if (element.elementGroup) {
      const start = out.length;
      flatten(element.elementGroup.children, matrix, depth + 1, element.objectId, out);
      entry.box = union(out.slice(start).filter(f => f.depth === depth + 1).map(f => f.box)) ?? entry.box;
    }
  }
  return out;
}
export const findElement = (elements: any[] | undefined, objectId: string) => flatten(elements).find(f => f.element.objectId === objectId);
