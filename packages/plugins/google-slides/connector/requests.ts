import { compact } from '../../_shared/reference';
import { optionalColor, solidFill } from './contrast';
import { placement, pt, type Box } from './geometry';

/** Slides object ids: 5-50 chars, starting with a letter. */
export const newId = (prefix = 'ot') => `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`;
export const createShape = (objectId: string, shapeType: string, pageObjectId: string, box: Box) => ({ createShape: { objectId, shapeType, elementProperties: placement(pageObjectId, box) } });
export const insertText = (objectId: string, text: string, cellLocation?: unknown) => ({ insertText: compact({ objectId, cellLocation, text, insertionIndex: 0 }) });

export type CharStyle = { fontSize?: number; bold?: boolean; italic?: boolean; underline?: boolean; strikethrough?: boolean; fontFamily?: string; color?: string };
/** updateTextStyle touching only the given properties (fields mask), or undefined when none are given. */
export function textStyle(objectId: string, s: CharStyle, textRange: unknown = { type: 'ALL' }, cellLocation?: unknown) {
  const style: Record<string, unknown> = {}, fields: string[] = [];
  if (s.fontSize !== undefined) { style.fontSize = pt(s.fontSize); fields.push('fontSize'); }
  for (const key of ['bold', 'italic', 'underline', 'strikethrough'] as const) if (s[key] !== undefined) { style[key] = s[key]; fields.push(key); }
  if (s.fontFamily) { style.fontFamily = s.fontFamily; fields.push('fontFamily'); }
  if (s.color) { style.foregroundColor = optionalColor(s.color); fields.push('foregroundColor'); }
  return fields.length ? { updateTextStyle: compact({ objectId, cellLocation, textRange, style, fields: fields.join(',') }) } : undefined;
}
export function paragraphStyle(objectId: string, s: { alignment?: string; lineSpacing?: number; spaceAbove?: number; spaceBelow?: number }, textRange: unknown = { type: 'ALL' }) {
  const style: Record<string, unknown> = {}, fields: string[] = [];
  if (s.alignment) { style.alignment = s.alignment; fields.push('alignment'); }
  if (s.lineSpacing !== undefined) { style.lineSpacing = s.lineSpacing; fields.push('lineSpacing'); }
  for (const key of ['spaceAbove', 'spaceBelow'] as const) if (s[key] !== undefined) { style[key] = pt(s[key]!); fields.push(key); }
  return fields.length ? { updateParagraphStyle: { objectId, textRange, style, fields: fields.join(',') } } : undefined;
}
/** updateShapeProperties for fill, outline (null hides it) and vertical text alignment. */
export function shapeStyle(objectId: string, s: { fill?: string; outline?: string | null; contentAlignment?: string }) {
  const shapeProperties: Record<string, unknown> = {}, fields: string[] = [];
  if (s.fill) { shapeProperties.shapeBackgroundFill = solidFill(s.fill); fields.push('shapeBackgroundFill.solidFill.color'); }
  if (s.outline === null) { shapeProperties.outline = { propertyState: 'NOT_RENDERED' }; fields.push('outline.propertyState'); }
  else if (s.outline) { shapeProperties.outline = { outlineFill: solidFill(s.outline), propertyState: 'RENDERED' }; fields.push('outline.outlineFill.solidFill.color', 'outline.propertyState'); }
  if (s.contentAlignment) { shapeProperties.contentAlignment = s.contentAlignment; fields.push('contentAlignment'); }
  return fields.length ? { updateShapeProperties: { objectId, shapeProperties, fields: fields.join(',') } } : undefined;
}
export const pageBackground = (objectId: string, color: string) => ({ updatePageProperties: { objectId, pageProperties: { pageBackgroundFill: solidFill(color) }, fields: 'pageBackgroundFill.solidFill.color' } });
export const defined = <T>(items: Array<T | undefined | false>) => items.filter(Boolean) as T[];
