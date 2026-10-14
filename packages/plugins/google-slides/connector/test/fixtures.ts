export const emu = (pt: number) => pt * 12700;
export const text = (content: string, style: Record<string, unknown> = {}, paragraph: Record<string, unknown> = {}) => ({ textElements: content.split('\n').flatMap(line => [{ paragraphMarker: { style: paragraph } }, { textRun: { content: `${line}\n`, style } }]) });
export const rgb = (hex: string) => ({ red: parseInt(hex.slice(1, 3), 16) / 255, green: parseInt(hex.slice(3, 5), 16) / 255, blue: parseInt(hex.slice(5, 7), 16) / 255 });
export const fill = (hex: string) => ({ shapeBackgroundFill: { solidFill: { color: { rgbColor: rgb(hex) }, alpha: 1 } } });
export const color = (hex: string) => ({ foregroundColor: { opaqueColor: { rgbColor: rgb(hex) } } });
export const size = (pt: number) => ({ fontSize: { magnitude: pt, unit: 'PT' } });
export const element = (objectId: string, x: number, y: number, width: number, height: number, body: Record<string, unknown>, transform: Record<string, unknown> = {}) => ({
  objectId,
  size: { width: { magnitude: emu(width), unit: 'EMU' }, height: { magnitude: emu(height), unit: 'EMU' } },
  transform: { scaleX: 1, scaleY: 1, translateX: emu(x), translateY: emu(y), unit: 'EMU', ...transform },
  ...body,
});
export const box = (objectId: string, x: number, y: number, width: number, height: number, shape: Record<string, unknown> = {}) => element(objectId, x, y, width, height, { shape: { shapeType: 'TEXT_BOX', ...shape } });
export const pageSize = { width: { magnitude: 9144000, unit: 'EMU' }, height: { magnitude: 5143500, unit: 'EMU' } };
