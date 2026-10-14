import { isHex } from './contrast';
import type { CardNode, Edges, LayoutNode, Role, Size, TextNode } from './layout';

/**
 * Compile compose_slide's HTML/CSS subset to a layout tree. Only documented tags, classes and CSS
 * properties compile; everything else is collected and refused by name before anything is written.
 */
type El = { tag: string; attrs: Record<string, string>; children: Array<El | string> };
const VOID = new Set(['img', 'hr', 'br', 'meta', 'link', 'input']);
const OPTIONAL_CLOSE = new Set(['li', 'p']);
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', bull: '•', middot: '·', copy: '©', reg: '®', trade: '™', times: '×', euro: '€', pound: '£', yen: '¥', deg: '°', rarr: '→', larr: '←', check: '✓' };
const codePoint = (m: string, value: number) => { try { return String.fromCodePoint(value); } catch { return m; } };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => e[0] === '#' ? codePoint(m, e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e.toLowerCase()] ?? m);

export function parseHtml(html: string): Array<El | string> {
  const root: El = { tag: '#root', attrs: {}, children: [] }, stack = [root];
  const pattern = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/\s*([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>|([^<]+)|</g;
  for (const m of html.matchAll(pattern)) {
    const top = stack.at(-1)!;
    if (m[0].startsWith('<!--')) continue;
    if (/^<!doctype/i.test(m[0])) throw new Error('Unsupported HTML: <!doctype>; send only the slide markup (a <section> root)');
    if (m[1]) {
      const tag = m[1].toLowerCase(), at = stack.findLastIndex(e => e.tag === tag);
      if (at < 1) throw new Error(`Malformed HTML: </${tag}> has no matching <${tag}>`);
      const unclosed = stack.slice(at + 1).find(e => !OPTIONAL_CLOSE.has(e.tag));
      if (unclosed) throw new Error(`Malformed HTML: </${tag}> closes <${tag}> while <${unclosed.tag}> is still open`);
      stack.length = at;
    } else if (m[2]) {
      const tag = m[2].toLowerCase(), attrs: Record<string, string> = {};
      for (const a of (m[3] ?? '').matchAll(/([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) attrs[a[1]!.toLowerCase()] = decode(a[2] ?? a[3] ?? a[4] ?? '');
      if (OPTIONAL_CLOSE.has(tag) && top.tag === tag) stack.pop();
      const el: El = { tag, attrs, children: [] };
      stack.at(-1)!.children.push(el);
      if (!VOID.has(tag) && !m[4]) stack.push(el);
    } else if (m[5]) top.children.push(decode(m[5]));
    else throw new Error('Malformed HTML: a "<" that does not start a tag; write &lt; for a literal "<"');
  }
  const open = stack.slice(1).find(e => !OPTIONAL_CLOSE.has(e.tag));
  if (open) throw new Error(`Malformed HTML: <${open.tag}> is never closed`);
  return root.children;
}

const PROPS = ['display', 'flex-direction', 'grid-template-columns', 'gap', 'padding', 'flex', 'width', 'height', 'justify-content', 'text-align', 'color', 'background', 'font-size', 'font-weight'];
const CLASSES = ['card', 'display', 'kpi', 'caption', 'shrink'];
const TAGS = ['section', 'div', 'article', 'h1', 'h2', 'p', 'span', 'ul', 'ol', 'li', 'img', 'hr'];
const TEXT_ROLE: Record<string, Role> = { h1: 'h1', h2: 'h2', p: 'body', span: 'body' };
const ROLES = ['background', 'surface', 'primary', 'onBackground', 'onSurface', 'onPrimary', 'textSecondary'];
type Inherit = { color?: string; align?: TextNode['align'] };
type Axis = 'row' | 'column' | 'grid' | 'card' | 'root';
const collapse = (parts: string[]) => parts.join('').replace(/\s+/g, ' ').trim();

export function compileHtml(html: string): { root: LayoutNode; background?: string; padding?: Edges } {
  const problems = new Set<string>();
  const problem = (text: string) => { problems.add(text); return undefined; };
  const length = (prop: string, value: string, tag: string) => {
    const m = /^(-?\d*\.?\d+)(pt|px)?$/i.exec(value.trim());
    if (!m || (!m[2] && Number(m[1]) !== 0) || Number(m[1]) < 0) return problem(`${prop}: ${value} on <${tag}> (lengths are pt or px)`);
    return Number(m[1]) * (m[2]?.toLowerCase() === 'px' ? 0.75 : 1);
  };
  const color = (prop: string, value: string, tag: string, roles = ROLES) => {
    const v = value.trim();
    if (/^#[0-9a-f]{3}$/i.test(v)) return `#${[...v.slice(1)].map(c => c + c).join('')}`.toUpperCase();
    if (isHex(v)) return v.toUpperCase();
    if (roles.includes(v)) return v;
    return problem(`${prop}: ${value} on <${tag}> (use #RRGGBB, #RGB or a theme role: ${roles.join(', ')})`);
  };
  const styles = (el: El, allowed: string[]) => {
    const css: Record<string, string> = {};
    for (const declaration of (el.attrs.style ?? '').split(';')) {
      if (!declaration.trim()) continue;
      const at = declaration.indexOf(':'), prop = declaration.slice(0, at).trim().toLowerCase(), value = declaration.slice(at + 1).trim();
      if (at < 0 || !value) { problem(`CSS declaration "${declaration.trim()}" on <${el.tag}>`); continue; }
      if (!PROPS.includes(prop)) { problem(`CSS property "${prop}"`); continue; }
      if (!allowed.includes(prop)) { problem(`CSS "${prop}" on <${el.tag}>${prop === 'background' ? ' (only the root and cards take a background)' : ''}`); continue; }
      css[prop] = value;
    }
    return css;
  };
  const checkAttrs = (el: El, extra: string[] = []) => {
    for (const name of Object.keys(el.attrs)) if (!['class', 'style', ...extra].includes(name)) problem(`attribute "${name}" on <${el.tag}>`);
    const classes = (el.attrs.class ?? '').split(/\s+/).filter(Boolean);
    for (const c of classes) if (!CLASSES.includes(c)) problem(`class "${c}"`);
    return classes;
  };
  const size = (css: Record<string, string>, axis: Axis, tag: string): Size | undefined => {
    const main = axis === 'row' ? 'width' : 'height', cross = axis === 'row' ? 'height' : 'width';
    if (axis === 'grid' || axis === 'root') { for (const p of ['flex', 'width', 'height']) if (css[p]) problem(`${p} on <${tag}> (${axis === 'grid' ? 'grid cells are equal-sized' : 'the root fills the slide inside its padding'})`); return; }
    if (css[cross]) return problem(`${cross} on <${tag}> inside a ${axis === 'row' ? 'row' : 'column'} (children stretch across; size them with ${main} or flex)`);
    if (css.flex && css[main]) return problem(`both flex and ${main} on <${tag}>; use one`);
    if (css.flex) { const f = Number(css.flex.trim().split(/\s+/)[0]); return f > 0 ? { flex: f } : problem(`flex: ${css.flex} on <${tag}> (use a positive number)`); }
    return css[main] ? length(main, css[main]!, tag) : undefined;
  };
  const align = (value: string | undefined, tag: string): TextNode['align'] | undefined => {
    if (!value) return;
    const v = ({ left: 'start', start: 'start', center: 'center', right: 'end', end: 'end' } as Record<string, TextNode['align']>)[value.trim()];
    return v ?? problem(`text-align: ${value} on <${tag}>`);
  };
  const justify = (value: string | undefined, tag: string) => {
    if (!value) return;
    const v = ({ start: 'start', 'flex-start': 'start', center: 'center', end: 'end', 'flex-end': 'end', 'space-between': 'space-between', 'space-evenly': 'space-evenly' } as Record<string, CardNode['justify']>)[value.trim()];
    return v ?? problem(`justify-content: ${value} on <${tag}>`);
  };
  const padding = (value: string | undefined, tag: string): Edges | undefined => {
    if (!value) return;
    const parts = value.trim().split(/\s+/).map(v => length('padding', v, tag));
    if (parts.some(p => p === undefined) || parts.length > 4) return problem(`padding: ${value} on <${tag}>`);
    const [t, r = t, b = t, l = r] = parts as number[];
    return [t!, r!, b!, l!];
  };
  const textStyle = (css: Record<string, string>, inherit: Inherit, tag: string) => {
    const weight = css['font-weight']?.trim();
    const bold = weight === undefined ? undefined : weight === 'bold' || weight === 'bolder' ? true : weight === 'normal' || weight === 'lighter' ? false : /^\d+$/.test(weight) ? Number(weight) >= 600 : problem(`font-weight: ${weight} on <${tag}>`);
    return { color: css.color ? color('color', css.color, tag) : inherit.color, align: align(css['text-align'], tag) ?? inherit.align, bold, fontSize: css['font-size'] ? length('font-size', css['font-size'], tag) : undefined };
  };
  const TEXT_PROPS = ['color', 'text-align', 'font-size', 'font-weight', 'flex', 'width', 'height'];
  const text = (el: El, axis: Axis, inherit: Inherit): TextNode | undefined => {
    const classes = checkAttrs(el), css = styles(el, TEXT_PROPS);
    let content: string;
    if (el.tag === 'ul' || el.tag === 'ol') {
      const items: string[] = [];
      const walk = (list: El, depth: number) => {
        for (const child of list.children) {
          if (typeof child === 'string') { if (child.trim()) problem(`text directly inside <${list.tag}> (wrap it in <li>)`); continue; }
          if (child.tag !== 'li') { problem(`<${child.tag}> inside <${list.tag}> (lists hold <li> items)`); continue; }
          if (Object.keys(child.attrs).length) problem('attributes on <li>');
          items.push('\t'.repeat(depth) + collapse(child.children.filter((c): c is string => typeof c === 'string')));
          for (const nested of child.children) if (typeof nested !== 'string') nested.tag === 'ul' || nested.tag === 'ol' ? walk(nested, depth + 1) : problem(`<${nested.tag}> inside <li> (items hold plain text and nested lists)`);
        }
      };
      walk(el, 0);
      content = items.join('\n');
    } else {
      for (const child of el.children) if (typeof child !== 'string') problem(`<${child.tag}> inside <${el.tag}> (text elements hold plain text)`);
      content = collapse(el.children.filter((c): c is string => typeof c === 'string'));
    }
    if (!content.trim()) return problem(`empty <${el.tag}>`);
    if (classes.includes('card')) problem(`class "card" on <${el.tag}> (use <article> or <div class="card">)`);
    const role = (['display', 'kpi', 'caption'] as Role[]).find(r => classes.includes(r)) ?? TEXT_ROLE[el.tag] ?? 'body';
    const s = textStyle(css, inherit, el.tag);
    return compactNode({ kind: 'text', text: content.slice(0, 10000), role, color: s.color, align: s.align, bold: s.bold, fontSize: s.fontSize, fit: classes.includes('shrink') ? 'shrink' : undefined, bullets: el.tag === 'ul' || undefined, numbered: el.tag === 'ol' || undefined, size: size(css, axis, el.tag) }) as TextNode;
  };
  const isText = (el: El) => el.tag in TEXT_ROLE || el.tag === 'ul' || el.tag === 'ol';
  const card = (el: El, axis: Axis, inherit: Inherit, root: { background?: string; padding?: Edges } | undefined): LayoutNode | undefined => {
    const classes = checkAttrs(el), css = styles(el, ['display', 'flex-direction', 'gap', 'padding', 'justify-content', 'background', 'flex', 'width', 'height', 'color', 'text-align']);
    for (const c of classes) if (c !== 'card' && CLASSES.includes(c)) problem(`class "${c}" on a card`);
    if (css.display && !['flex', 'block'].includes(css.display)) problem(`display: ${css.display} on a card (cards stack their text in a column)`);
    if (css['flex-direction'] && css['flex-direction'] !== 'column') problem(`flex-direction: ${css['flex-direction']} on a card (cards stack their text in a column)`);
    const own = textStyle({ color: css.color ?? '', 'text-align': css['text-align'] ?? '' }, inherit, el.tag);
    const children: TextNode[] = [];
    for (const child of el.children) {
      if (typeof child === 'string') { if (child.trim()) children.push({ kind: 'text', text: collapse([child]), role: 'body', ...compactNode({ color: own.color, align: own.align }) }); continue; }
      if (!isText(child)) { problem(`<${child.tag}> inside a card (cards hold text only: h1, h2, p, span, ul, ol)`); continue; }
      const node = text(child, 'card', { color: own.color, align: own.align });
      if (node) children.push(node);
    }
    if (!children.length) return problem(`empty card <${el.tag}>`);
    const background = css.background ? color('background', css.background, el.tag, ['surface', 'primary', 'background']) : undefined;
    if (root) { root.background = background && isHex(background) ? background : undefined; root.padding = padding(css.padding, el.tag); }
    return compactNode({ kind: 'card', children: children.slice(0, 8), surface: root ? undefined : background, padding: root ? undefined : padding(css.padding, el.tag), gap: css.gap ? length('gap', css.gap, el.tag) : undefined, justify: justify(css['justify-content'], el.tag), size: size(css, axis, el.tag) }) as CardNode;
  };
  const container = (el: El, axis: Axis, inherit: Inherit, root: { background?: string; padding?: Edges } | undefined): LayoutNode | undefined => {
    for (const c of checkAttrs(el)) if (CLASSES.includes(c)) problem(`class "${c}" on <${el.tag}>`);
    const css = styles(el, ['display', 'flex-direction', 'grid-template-columns', 'gap', 'padding', 'justify-content', 'flex', 'width', 'height', 'color', 'text-align', ...(root ? ['background'] : [])]);
    const own = textStyle({ color: css.color ?? '', 'text-align': css['text-align'] ?? '' }, inherit, el.tag);
    const inheritNext = { color: own.color, align: own.align };
    const display = css.display?.trim() ?? 'block';
    if (!['block', 'flex', 'grid'].includes(display)) problem(`display: ${display} on <${el.tag}>`);
    if (css['flex-direction'] && display !== 'flex') problem(`flex-direction on <${el.tag}> without display:flex`);
    if (css['grid-template-columns'] && display !== 'grid') problem(`grid-template-columns on <${el.tag}> without display:grid`);
    const direction = display === 'flex' ? css['flex-direction']?.trim() ?? 'row' : 'column';
    if (!['row', 'column'].includes(direction)) problem(`flex-direction: ${direction} on <${el.tag}>`);
    let columns: number | undefined;
    if (display === 'grid') {
      const spec = css['grid-template-columns']?.trim() ?? '';
      const m = /^repeat\(\s*(\d+)\s*,\s*1fr\s*\)$/.exec(spec), parts = spec.split(/\s+/);
      columns = m ? Number(m[1]) : parts.every(p => p === '1fr') && spec ? parts.length : undefined;
      if (!columns || columns > 6) problem(`grid-template-columns: ${spec || '(missing)'} on <${el.tag}> (use repeat(N, 1fr) with N 1-6)`);
      if (css['justify-content']) problem(`justify-content on a grid <${el.tag}>`);
    }
    const childAxis: Axis = display === 'grid' ? 'grid' : direction === 'row' ? 'row' : 'column';
    const children: LayoutNode[] = [];
    for (const child of el.children) {
      if (typeof child === 'string') { if (child.trim()) children.push(compactNode({ kind: 'text', text: collapse([child]), role: 'body', color: inheritNext.color, align: inheritNext.align }) as TextNode); continue; }
      const node = convert(child, childAxis, inheritNext);
      if (node) children.push(node);
    }
    if (!children.length) return problem(`empty <${el.tag}>`);
    if (root) { root.background = css.background ? color('background', css.background, el.tag, []) : undefined; root.padding = padding(css.padding, el.tag); }
    const common = { gap: css.gap ? length('gap', css.gap, el.tag) : undefined, size: size(css, axis, el.tag), padding: root ? undefined : padding(css.padding, el.tag) };
    return compactNode(display === 'grid' ? { kind: 'grid', columns: columns ?? 1, rows: Math.max(1, Math.ceil(children.length / (columns ?? 1))), children, ...common } : { kind: 'stack', direction, justify: justify(css['justify-content'], el.tag), children, ...common }) as LayoutNode;
  };
  const convert = (el: El, axis: Axis, inherit: Inherit, root?: { background?: string; padding?: Edges }): LayoutNode | undefined => {
    if (!TAGS.includes(el.tag)) return problem(`tag <${el.tag}>`);
    const classes = (el.attrs.class ?? '').split(/\s+/);
    if (el.tag === 'article' || ((el.tag === 'div' || el.tag === 'section') && classes.includes('card'))) return card(el, axis, inherit, root);
    if (el.tag === 'section' || el.tag === 'div') return container(el, axis, inherit, root);
    if (isText(el)) return text(el, axis, inherit);
    if (el.tag === 'li') return problem('<li> outside a list');
    const css = styles(el, ['flex', 'width', 'height']);
    if (el.tag === 'img') {
      for (const c of checkAttrs(el, ['src', 'alt'])) if (CLASSES.includes(c)) problem(`class "${c}" on <img>`);
      if (!/^https?:\/\/\S+$/i.test(el.attrs.src ?? '')) return problem(`<img> without a public http(s) src`);
      return compactNode({ kind: 'image', url: el.attrs.src!, alt: el.attrs.alt || undefined, size: size(css, axis, 'img') }) as LayoutNode;
    }
    for (const c of checkAttrs(el)) if (CLASSES.includes(c)) problem(`class "${c}" on <hr>`);
    return compactNode({ kind: 'spacer', size: size(css, axis, 'hr') }) as LayoutNode;
  };

  const top = parseHtml(html);
  const elements = top.filter((n): n is El => typeof n !== 'string');
  const strayText = top.some(n => typeof n === 'string' && n.trim());
  const rootInfo: { background?: string; padding?: Edges } = {};
  let root: LayoutNode | undefined;
  if (elements.length === 1 && !strayText && ['section', 'div', 'article'].includes(elements[0]!.tag)) root = convert(elements[0]!, 'root', {}, rootInfo);
  else {
    const children = top.flatMap(n => typeof n === 'string' ? (n.trim() ? [{ kind: 'text', text: collapse([n]), role: 'body' } as TextNode] : []) : defined(convert(n, 'column', {})));
    root = children.length ? { kind: 'stack', direction: 'column', children } : problem('no slide content');
  }
  if (problems.size) throw new Error(`Unsupported HTML/CSS, nothing was written: ${[...problems].join('; ')}. Supported tags: ${TAGS.join(', ')}; classes: ${CLASSES.join(', ')}; CSS: ${PROPS.join(', ')}.`);
  return { root: root!, ...(rootInfo.background ? { background: rootInfo.background } : {}), ...(rootInfo.padding ? { padding: rootInfo.padding } : {}) };
}
const defined = <T>(value: T | undefined): T[] => value === undefined ? [] : [value];
const compactNode = <T extends Record<string, unknown>>(value: T) => Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
