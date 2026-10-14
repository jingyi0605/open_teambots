/** Colors and WCAG 2.x contrast. */
export const HEX = /^#[0-9a-fA-F]{6}$/;
export const isHex = (value: unknown): value is string => typeof value === 'string' && HEX.test(value);
const channels = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
export const toHex = (rgb: number[]) => `#${rgb.map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
export const normalizeHex = (hex: string) => hex.toUpperCase();
/** Slides RgbColor floats from "#RRGGBB". */
export const rgbColor = (hex: string) => { const [red, green, blue] = channels(hex).map(v => v / 255); return { red, green, blue }; };
/** "#RRGGBB" from a Slides RgbColor (absent channels are 0). */
export const fromRgb = (c: any) => toHex([(c?.red ?? 0) * 255, (c?.green ?? 0) * 255, (c?.blue ?? 0) * 255]);
export const solidFill = (hex: string) => ({ solidFill: { color: { rgbColor: rgbColor(hex) } } });
export const optionalColor = (hex: string) => ({ opaqueColor: { rgbColor: rgbColor(hex) } });
/** A Slides OpaqueColor as "#RRGGBB", or "theme" for a theme color reference. */
export const opaque = (c: any): string | undefined => c?.rgbColor ? fromRgb(c.rgbColor) : c?.themeColor ? 'theme' : undefined;

export const luminance = (hex: string) => {
  const [r, g, b] = channels(hex).map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
export const contrast = (a: string, b: string) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi! + 0.05) / (lo! + 0.05); };
/** WCAG large text as this connector defines it: 24 pt+, or bold 19 pt+. */
export const isLarge = (size: number, bold = false) => size >= 24 || (bold && size >= 19);
export const minimum = (large: boolean) => large ? 3 : 4.5;
export const mix = (from: string, to: string, t: number) => { const a = channels(from), b = channels(to); return toHex(a.map((v, i) => v + (b[i]! - v) * t)); };
export const blend = (top: string, bottom: string, alpha: number) => mix(bottom, top, alpha);

/** The nearest tint (toward white) or shade (toward black) of text that reaches the required ratio on background. */
export function nearestPassing(text: string, background: string, required: number) {
  const search = (target: string) => {
    for (let step = 1; step <= 200; step++) {
      const color = mix(text, target, step / 200);
      const value = contrast(color, background);
      if (value >= required) return { color, ratio: value, step };
    }
  };
  const tint = search('#FFFFFF'), shade = search('#000000');
  const best = !tint ? shade : !shade ? tint : tint.step <= shade.step ? tint : shade;
  return best && { color: best.color, ratio: Math.floor(best.ratio * 100) / 100, kind: best === tint ? 'tint' : 'shade' };
}
/** A readable text color for a fill: white or near-black, whichever contrasts more (pure black when neither reaches 4.5:1). */
export function onColor(fill: string) {
  const options = ['#FFFFFF', '#202124'].sort((a, b) => contrast(b, fill) - contrast(a, fill));
  return contrast(options[0]!, fill) >= 4.5 ? options[0]! : contrast('#000000', fill) > contrast('#FFFFFF', fill) ? '#000000' : '#FFFFFF';
}
export const ratioText = (value: number) => `${Math.floor(value * 100) / 100}:1`;
export function checkPair(pair: { text: string; background: string; large?: boolean }) {
  const text = normalizeHex(pair.text), background = normalizeHex(pair.background), large = Boolean(pair.large);
  const value = contrast(text, background), required = minimum(large);
  const passes = value >= required;
  const suggestion = passes ? undefined : nearestPassing(text, background, required);
  return { text, background, large, ratio: Math.floor(value * 100) / 100, required, passesAA: passes, ...(suggestion ? { suggestion: suggestion.color, suggestionRatio: suggestion.ratio, suggestionKind: suggestion.kind } : {}) };
}
