import {expect,test} from "bun:test";
import {describeTrigger,normalizeMainToolArguments} from "../src/reference-main-parsers";
import {parseHostAwaitShellRequest} from "../src/service-protocol";
import {ShellToolInput} from "../src";
import {Schema} from "effect";

test("shell waits accept captured numeric spellings and preserve the delivery envelope",()=>{
  expect(normalizeMainToolArguments("Shell",{command:"true",block_until_ms:" 12.9 "})).toMatchObject({block_until_ms:12});
  expect(parseHostAwaitShellRequest({shell_id:12,block_until_ms:" 0 "})).toEqual({shell_id:"12",block_until_ms:0});
  expect(parseHostAwaitShellRequest({block_until_ms:"-1"})).toEqual({block_until_ms:30_000});
  expect(()=>parseHostAwaitShellRequest({block_until_ms:""})).toThrow();
  expect(()=>parseHostAwaitShellRequest({block_until_ms:"7140001"})).toThrow();
  expect(normalizeMainToolArguments("SendToUser",{type:"text",content:"done",end_turn:true})).toMatchObject({end_turn:true});
  expect(Schema.decodeUnknownSync(ShellToolInput)(normalizeMainToolArguments("Shell",{command:"true",block_until_ms:"8000000"}))).toMatchObject({block_until_ms:8_000_000});
});
test("email routine triggers parse, describe, and validate against the model-facing schema", async () => {
  const { createToolValidator } = await import("@openteam/plugin-sdk/json-schema");
  const native = (await import("../src/native-tools.json")).default as { native: Array<{ name: string; parameters: Record<string, unknown> }> };
  const validate = createToolValidator(native.native.find((tool) => tool.name === "update_state")!.parameters);
  const trigger = { type: "email", inbox: "bot@raghav.sh", from: ["me@raghav.sh", "@partner.com"] };
  const input = { target: "routine", action: "create", name: "Reply to mail", prompt: "Answer the sender.", trigger };
  expect(validate(input).valid).toBe(true);
  expect(validate({ ...input, trigger: [{ type: "cron", schedule: "0 9 * * 1-5" }, trigger] }).valid).toBe(true);
  expect(validate({ ...input, trigger: { type: "email" } }).valid).toBe(false);
  expect(normalizeMainToolArguments("update_state", input).trigger).toEqual(trigger);
  expect(() => normalizeMainToolArguments("update_state", { ...input, trigger: { type: "group", listeners: [{ type: "origin", repo: "o/r", events: ["pr-opened"] }, trigger] } })).toThrow("Origin can't be grouped with email");
  expect(describeTrigger(trigger)).toBe("When email arrives at bot@raghav.sh");
  expect(describeTrigger({ ...trigger, requireAuthPass: false })).toBe("When email arrives at bot@raghav.sh, including unauthenticated senders");
  expect(describeTrigger({ type: "group", listeners: [{ type: "cron", schedule: "0 9 * * 1-5" }, trigger] })).toContain("or when email arrives at bot@raghav.sh");
});
