import { Streamdown } from "streamdown";
import {
  messageComponents,
  messageRemarkPlugins,
  messageUrlTransform,
  prepareMessageMarkdown,
  streamdownControls,
} from "./message-response/config";

export default function RichMessageResponse({ children }: { children: string }) {
  return (
    <Streamdown
      className="bot-markdown"
      components={messageComponents}
      controls={streamdownControls}
      lineNumbers={false}
      remarkPlugins={messageRemarkPlugins}
      urlTransform={messageUrlTransform}
    >
      {prepareMessageMarkdown(children)}
    </Streamdown>
  );
}
