import { expect, test } from "bun:test";
import { RuntimeTools } from "../../src/runtime/tools";

async function pluginCall(body: unknown) {
  const tools = new RuntimeTools({} as any, "http://unused.invalid", "fixture", "/tmp", "/tmp") as any;
  const active: any = {runId: "fixture", botId: "fixture", screenBotId: "fixture", sentMessageCount: 0, pendingSteers: [], queue: {push() {}}};
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => Response.json(body)) as any;
    return await tools.callControlPlaneToolRequest(active, "call", "PluginCall", {connectionId: "c", namespace: "plugin_c", toolName: "get_slide_thumbnail", arguments: {}});
  } finally { globalThis.fetch = originalFetch; }
}

test("plugin MCP image content reaches the model as image parts, not base64 text", async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString("base64");
  const result = await pluginCall({content: [{type: "image", data: png, mimeType: "image/png"}, {type: "text", text: "{\"pageObjectId\":\"p\",\"width\":800,\"height\":450}"}]});
  expect(result.content).toHaveLength(2);
  expect(result.content[1]).toEqual({type: "image", data: png, mimeType: "image/png"});
  expect(result.content[0].type).toBe("text");
  expect(result.content[0].text).not.toContain(png);
  expect(result.content[0].text).toContain("attachedBelow");
  expect(result.content[0].text).toContain("pageObjectId");
});

test("text-only plugin results render exactly as before", async () => {
  const body = {content: [{type: "text", text: "{\"ok\":true}"}]};
  const result = await pluginCall(body);
  expect(result.content).toEqual([{type: "text", text: (await import("@openteam/contracts/tool-results")).renderControlResult("PluginCall", body, {})}]);
});
