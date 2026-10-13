import { defaultRemarkPlugins, type StreamdownProps } from "streamdown";
import { normalizeMessageMath } from "./math-markdown";

export const SANITIZED_MESSAGE_LINK_PREFIX = "streamdown:sand-msg:";
export const SANITIZED_OPENTEAM_LINK_PREFIX = "streamdown:openteam:";

/** Source normalization is independent of browser rendering and authentication. */
export const prepareMessageMarkdown = (markdown: string) =>
  normalizeMessageMath(markdown)
    .replace(/(\]\(\s*)sand-msg:/gi, `$1${SANITIZED_MESSAGE_LINK_PREFIX}`)
    .replace(/(\]\(\s*)openteam:/gi, `$1${SANITIZED_OPENTEAM_LINK_PREFIX}`);

type MarkdownNode = { type: string; value?: string; children?: MarkdownNode[] };

/** Keeps single line breaks inside paragraphs, matching the iOS renderer's
 * `breaks: true`. Bots often send one item per line without list markers. */
const remarkLineBreaks = () => (tree: MarkdownNode) => {
  const visit = (node: MarkdownNode) => {
    if (!node.children) return;
    node.children = node.children.flatMap((child) => {
      if (child.type !== "text" || !child.value?.includes("\n")) {
        visit(child);
        return [child];
      }
      return child.value
        .split(/\r?\n|\r/)
        .flatMap((value, index) => [
          ...(index > 0 ? [{ type: "break" }] : []),
          ...(value ? [{ type: "text", value }] : []),
        ]);
    });
  };
  visit(tree);
};

export const messageRemarkPlugins: StreamdownProps["remarkPlugins"] = [
  ...Object.values(defaultRemarkPlugins),
  remarkLineBreaks,
];
