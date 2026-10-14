import { describe, expect, test } from "bun:test";
import { createToolValidator } from "@openteam/plugin-sdk/json-schema";
import { tools } from "../server";

const ours = Object.fromEntries(tools("account-1").map((tool) => [tool.name, tool]));
const valid = (name: string, args: Record<string, unknown>) =>
  createToolValidator(ours[name]!.inputSchema)(args).valid;

describe("Email tool contracts", () => {
  test("Bots get four read-only tools with bounded inputs", () => {
    const bot = tools("account-1").filter((tool) => !tool._meta?.["openteam/hostOnly"]);
    expect(bot.map((tool) => tool.name)).toEqual([
      "ListEmailInboxes",
      "SearchEmailThreads",
      "ReadEmailThread",
      "ReadEmailAttachment",
      "SendEmail",
    ]);
    for (const name of ["ListEmailInboxes", "SearchEmailThreads", "ReadEmailThread", "ReadEmailAttachment"])
      expect(ours[name]!.annotations.readOnlyHint).toBe(true);
    expect(ours.SearchEmailThreads!.inputSchema.required).toEqual(["query"]);
    expect(ours.SearchEmailThreads!.inputSchema.properties.mode.enum).toEqual(["hybrid", "keyword", "semantic"]);
    expect(ours.ReadEmailThread!.inputSchema.required).toEqual(["thread_id"]);
    expect(ours.ReadEmailAttachment!.inputSchema.required).toEqual(["attachment_id"]);
    expect(ours.ListEmailInboxes!.description).toContain("(providerIdentifier account-1)");
  });

  test("typical calls validate and out-of-range ones do not", () => {
    expect(valid("ListEmailInboxes", {})).toBe(true);
    expect(valid("SearchEmailThreads", { query: "Q3 numbers", mode: "keyword" })).toBe(true);
    expect(
      valid("SearchEmailThreads", {
        query: "Q3 numbers",
        inbox_email: "bot@example.com",
        from_address: "alice@example.com",
        after: "2026-10-14T00:00:00Z",
        before: "2026-10-15T00:00:00Z",
        limit: 25,
        mode: "keyword",
      })
    ).toBe(true);
    expect(valid("ReadEmailThread", { thread_id: "INBOX:42", max_messages: 50, body_max_chars: 50000 })).toBe(true);
    expect(valid("ReadEmailAttachment", { attachment_id: "INBOX:42:0" })).toBe(true);
    expect(valid("SearchEmailThreads", { query: "x", limit: 26 })).toBe(false);
    expect(valid("SearchEmailThreads", { query: "x", mode: "fuzzy" })).toBe(false);
    expect(valid("ReadEmailThread", { thread_id: "INBOX:42", body_max_chars: 50001 })).toBe(false);
    expect(valid("ReadEmailThread", {})).toBe(false);
  });

  test("outbound mail goes through review cards", () => {
    expect(ours.SendEmail!.description).toContain("Everyone else needs a DraftExternalMessage card");
    for (const name of ["send_reviewed_email", "poll_new_mail"])
      expect(ours[name]!._meta).toEqual({ "openteam/hostOnly": true });
  });
});
