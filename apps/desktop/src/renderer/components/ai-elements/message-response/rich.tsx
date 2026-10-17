import { use, useMemo } from "react";
import { Streamdown } from "streamdown";
import {
  messageComponents,
  messageRemarkPlugins,
  messageUrlTransform,
  botMermaidOptions,
  botShikiTheme,
  prepareMessageMarkdown,
  streamdownControls,
} from "./config";
import type { AdvancedMessageCapabilities } from "./capabilities";
import { loadAdvancedMessagePlugins, markFulfilled } from "./plugins";
const codeComponents = import("./large-code");
// Settled before the first rich message renders, `use` then reads it directly.
void codeComponents.then((module) => markFulfilled(codeComponents, module));

export default function AdvancedMessageResponse({
  capabilities,
  children,
}: {
  capabilities: AdvancedMessageCapabilities;
  children: string;
}) {
  const plugins = use(loadAdvancedMessagePlugins(capabilities));
  const { MessagePre } = use(codeComponents);
  const richMessageComponents = useMemo(() => ({ ...messageComponents, pre: MessagePre }), [MessagePre]);
  return (
    <Streamdown
      className="bot-markdown"
      components={richMessageComponents}
      controls={streamdownControls}
      lineNumbers={false}
      mermaid={botMermaidOptions}
      plugins={plugins}
      remarkPlugins={messageRemarkPlugins}
      shikiTheme={botShikiTheme}
      urlTransform={messageUrlTransform}
    >
      {prepareMessageMarkdown(children)}
    </Streamdown>
  );
}
