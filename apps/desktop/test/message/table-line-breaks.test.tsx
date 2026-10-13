import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Streamdown } from "streamdown";
import { advancedMessageCapabilitiesFor } from "../../src/renderer/components/ai-elements/message-response/capabilities";
import {
  messageRemarkPlugins,
  prepareMessageMarkdown,
} from "../../src/renderer/components/ai-elements/message-response/markdown-source";
import { math } from "../../src/renderer/components/ai-elements/message-response/math";

const render = (source: string) =>
  renderToStaticMarkup(
    <Streamdown
      controls={{ table: false }}
      linkSafety={{ enabled: false }}
      mode="static"
      plugins={advancedMessageCapabilitiesFor(source)?.math ? { math } : undefined}
      remarkPlugins={messageRemarkPlugins}
    >
      {prepareMessageMarkdown(source)}
    </Streamdown>
  );
const text = (html: string) => html.replace(/<br\s*\/?>\n?/g, "\n").replace(/<[^>]*>/g, "");

describe("message tables and line breaks", () => {
  test("renders a currency table without treating prices as math", () => {
    const source = [
      "Checking `1234` · Sep 28–Oct 12",
      "",
      "| Date | Transaction | Money in | Money out | Status |",
      "|---|---|---:|---:|---|",
      "| Oct 10 | Coffee refund | $0.33 | — | Pending |",
      "| Oct 8 | Brokerage transfer | — | $4,000.00 | Posted |",
      "| **Posted total** | | **$1,250.00** | **$4,000.00** | |",
      "",
      "**Net posted change: −$2,750.00**, plus **$0.33 pending**.",
    ].join("\n");
    const html = render(source);

    expect(html.match(/data-streamdown="table-row"/g)).toHaveLength(4);
    expect(html).not.toContain('class="katex"');
    expect(text(html)).toContain("$1,250.00");
  });

  test("keeps one-item-per-line replies on separate lines", () => {
    const source =
      "Here they are for `1234`:\n\nOct 10: +$0.33 Coffee refund\nOct 8: −$4,000 Brokerage transfer\nOct 2: +$550.05 Payroll";
    const html = render(source);

    expect(html.match(/<br\s*\/?>/g)).toHaveLength(2);
    expect(text(html)).toContain(
      "Oct 10: +$0.33 Coffee refund\nOct 8: −$4,000 Brokerage transfer\nOct 2: +$550.05 Payroll"
    );
  });

  test("leaves code blocks, hard breaks and paragraph breaks unchanged", () => {
    const html = render("one  \ntwo\n\nthree\n\n```text\na\nb\n```");

    // Only the existing hard break: code lines and paragraph gaps add none.
    expect(html.match(/<br\s*\/?>/g)).toHaveLength(1);
    expect(text(html)).toContain("one\ntwo");
  });
});
