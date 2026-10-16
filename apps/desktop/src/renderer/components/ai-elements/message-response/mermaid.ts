import { type DiagramPlugin, mermaid as mermaidPlugin } from "@streamdown/mermaid";

type DiagramRender = ReturnType<ReturnType<DiagramPlugin["getMermaid"]>["render"]>;
type MermaidConfig = Parameters<DiagramPlugin["getMermaid"]>[0];

// Chat switches remount every visible message, and Streamdown lays out each
// diagram again on mount. Reusing the finished SVG keeps a revisited chat from
// waiting on Mermaid layout before it can be shown.
const MAX_CACHED_DIAGRAMS = 48;
const renders = new Map<string, DiagramRender>();
const rendered = new Set<string>();

const diagramKey = (config: MermaidConfig | undefined, source: string) =>
  `${JSON.stringify(config ?? null)}\n${source}`;

const cachedRender = (key: string, render: () => DiagramRender): DiagramRender => {
  const cached = renders.get(key);
  if (cached) {
    renders.delete(key);
    renders.set(key, cached);
    return cached;
  }
  const result = render();
  renders.set(key, result);
  result.then(
    () => {
      if (renders.get(key) === result) rendered.add(key);
    },
    // A failed render must be retried, not replayed from the cache.
    () => {
      if (renders.get(key) === result) renders.delete(key);
    }
  );
  while (renders.size > MAX_CACHED_DIAGRAMS) {
    const oldest = renders.keys().next().value;
    if (oldest === undefined) break;
    renders.delete(oldest);
    rendered.delete(oldest);
  }
  return result;
};

/**
 * Streamdown defers each inline diagram until it has been visible for 300 ms.
 * The patched renderer skips that wait for diagrams this cache already holds
 * (see patches/streamdown@2.6.0.patch).
 */
export const mermaid: DiagramPlugin & {
  isRendered: (source: string, config?: MermaidConfig) => boolean;
} = {
  ...mermaidPlugin,
  getMermaid(config) {
    const instance = mermaidPlugin.getMermaid(config);
    return {
      ...instance,
      render: (id, source) =>
        cachedRender(diagramKey(config, source), () => instance.render(id, source)),
    };
  },
  isRendered: (source, config) => rendered.has(diagramKey(config, source)),
};
