/**
 * Wrapped-text height estimation. Slides exposes no text metrics, so widths come from Arial's advance
 * widths (the Slides default font; regular and bold, ASCII) scaled by a per-family factor, and
 * lines are Slides' single spacing (~1.17 em) times the paragraph's lineSpacing. Estimates, not layout.
 */
// Advance widths in 1/1000 em for ASCII 32..126.
const REGULAR = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
// Average width relative to Arial; monospace families use a fixed 0.6 em.
const FAMILY: Record<string, number> = {
  arial: 1, helvetica: 1, roboto: 0.98, 'google sans': 1, 'open sans': 1.06, lato: 0.96, montserrat: 1.13, inter: 1.04, poppins: 1.1, raleway: 1.02, nunito: 1.01, 'source sans pro': 0.92, 'source sans 3': 0.92, 'pt sans': 0.94,
  verdana: 1.14, tahoma: 1.0, 'trebuchet ms': 0.98, calibri: 0.9, 'segoe ui': 1.0, georgia: 1.06, 'times new roman': 0.9, garamond: 0.88, merriweather: 1.12, 'playfair display': 1.0, lora: 1.0,
  'roboto condensed': 0.84, 'arial narrow': 0.82, oswald: 0.8, impact: 0.86, 'comic sans ms': 1.1,
};
const MONO = /mono|courier|consolas|menlo|source code/;
export const DEFAULT_SIZE = 18;
export const LINE = 1.17;
/** Slides' default text inset on every side (0.1 in). */
export const INSET = 7.2;

export function charEm(ch: string, bold = false): number {
  const code = ch.codePointAt(0) ?? 32;
  if (code >= 32 && code <= 126) return (bold ? BOLD : REGULAR)[code - 32]! / 1000;
  if (ch === '\t') return 0.556 * 2;
  if ((code >= 0x1100 && code <= 0x115f) || (code >= 0x2e80 && code <= 0xa4cf) || (code >= 0xac00 && code <= 0xd7a3) || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xfe30 && code <= 0xfe4f) || (code >= 0xff00 && code <= 0xff60) || code >= 0x1f000) return 1;
  if (code === 0x2014 || code === 0x2026) return 1;
  if (code === 0x2022 || code === 0x00b7) return 0.35;
  if (code === 0x2018 || code === 0x2019) return 0.222;
  return bold ? 0.6 : 0.556;
}
const familyFactor = (family?: string) => family ? FAMILY[family.trim().toLowerCase()] ?? 1 : 1;
export const textWidth = (text: string, size: number, bold = false, family?: string) => {
  if (family && MONO.test(family.toLowerCase())) return [...text].length * 0.6 * size;
  let em = 0; for (const ch of text) em += charEm(ch, bold);
  return em * size * familyFactor(family);
};

export type Run = { text: string; size: number; bold?: boolean; family?: string };
export type Paragraph = { runs: Run[]; lineSpacing?: number; spaceAbove?: number; spaceBelow?: number; indentStart?: number };

/** Greedy word wrap of one paragraph; widthFactor > 1 makes the estimate conservative. */
export function wrapParagraph(paragraph: Paragraph, width: number, widthFactor = 1) {
  const chars: string[] = [], widths: number[] = [];
  for (const run of paragraph.runs) for (const ch of run.text) { chars.push(ch); widths.push(textWidth(ch, run.size, run.bold, run.family) * widthFactor); }
  const size = Math.max(0, ...paragraph.runs.filter(r => r.text.length).map(r => r.size)) || Math.max(0, ...paragraph.runs.map(r => r.size)) || DEFAULT_SIZE;
  const available = Math.max(1, width - (paragraph.indentStart ?? 0));
  let lines = 1, x = 0, i = 0;
  while (i < chars.length) {
    if (chars[i] === '\u000b') { lines++; x = 0; i++; continue; }
    let j = i, word = 0;
    while (j < chars.length && chars[j] !== ' ' && chars[j] !== '\u000b') word += widths[j++]!;
    if (x > 0 && x + word > available) { lines++; x = 0; }
    if (word > available) for (let k = i; k < j; k++) { if (x > 0 && x + widths[k]! > available) { lines++; x = 0; } x += widths[k]!; }
    else x += word;
    while (j < chars.length && chars[j] === ' ') x += widths[j++]!;
    i = j;
  }
  const lineHeight = size * LINE * (paragraph.lineSpacing ?? 100) / 100;
  return { lines, height: lines * lineHeight + (paragraph.spaceAbove ?? 0) + (paragraph.spaceBelow ?? 0) };
}
/** Total wrapped line count and text height (without insets) for paragraphs in a box width (insets removed). */
export function measure(paragraphs: Paragraph[], boxWidth: number, widthFactor = 1, inset = INSET) {
  let lines = 0, height = 0;
  for (const paragraph of paragraphs) { const r = wrapParagraph(paragraph, boxWidth - 2 * inset, widthFactor); lines += r.lines; height += r.height; }
  return { lines, height };
}
/** Plain text as uniformly styled paragraphs (newlines separate paragraphs; leading tabs are bullet nesting). */
export const paragraphsOf = (text: string, size: number, bold = false, family?: string, bullets = false): Paragraph[] =>
  text.split('\n').map(line => {
    const level = bullets ? /^\t*/.exec(line)![0].length : 0;
    return { runs: [{ text: bullets ? line.slice(level) : line, size, bold, family }], lineSpacing: 100, indentStart: bullets ? 36 * (level + 1) : 0 };
  });
/** Rendered height of a text box in points: wrapped text plus top and bottom insets. */
export const boxHeightFor = (paragraphs: Paragraph[], boxWidth: number, widthFactor = 1) => measure(paragraphs, boxWidth, widthFactor).height + 2 * INSET;
