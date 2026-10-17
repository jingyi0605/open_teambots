import { describe, expect, test } from "bun:test";
import type { ChannelMessageView, ClientBootstrapView } from "@openteam/contracts";
import type { LoadedChannelHistory } from "@openteam/product-core/history";
import { bootstrapSnapshot } from "../../src/renderer/lib/bootstrap-snapshot";
import { emptyChannelMessageWindow } from "../../src/renderer/lib/message-history-window";

const channel = (id: string) => ({ id, kind: "bot_dm", name: id, members: [] });

const message = (channelId: string, sequence: number): ChannelMessageView => ({
  id: `${channelId}-m${sequence}`,
  clientId: null,
  sequence: String(sequence),
  channelId,
  sender: "agent",
  senderBotId: "bot-1",
  sourceRunId: null,
  content: `message ${sequence}`,
  metadata: {},
  createdAt: new Date(Date.UTC(2026, 9, 16, 12, 0, sequence)).toISOString(),
});

const bootstrap = (latestMessages: ChannelMessageView[]): ClientBootstrapView =>
  ({
    cursor: "100",
    workspace: {},
    bots: [],
    channels: [channel("loaded"), channel("preview")],
    latestMessages,
    activeRuns: [],
    channelRounds: [],
    subagents: [],
    runtime: {},
    capabilities: {},
  }) as unknown as ClientBootstrapView;

const history = (messages: ChannelMessageView[], loadedAt = 1): LoadedChannelHistory => ({
  messages,
  threadContext: [],
  searchContext: [],
  searchThreadContext: [],
  threadContextTruncated: false,
  searchThreadContextTruncated: false,
  beforeSequence: null,
  hasMore: false,
  loading: loadedAt === 0,
  loadedAt,
});

const project = (latest: ChannelMessageView[], loaded: LoadedChannelHistory) =>
  bootstrapSnapshot(
    bootstrap(latest),
    new Map([["loaded", loaded]]),
    new Map([["loaded", emptyChannelMessageWindow()]]),
    new Map()
  );

describe("bootstrap snapshot", () => {
  test("withholds a newer bootstrap message from a loaded transcript until history has it", () => {
    const transcript = [message("loaded", 1), message("loaded", 2)];
    const newest = message("loaded", 5);
    const { snapshot, detachedMessageIds } = project(
      [newest, message("preview", 3)],
      history(transcript)
    );

    // Previews and unread state still see the newest message.
    expect(snapshot.channelMessages.map(({ id }) => id)).toEqual([
      "loaded-m1",
      "loaded-m2",
      "loaded-m5",
      "preview-m3",
    ]);
    // Messages 3 and 4 are unknown, so the transcript must not show 5 yet.
    expect([...detachedMessageIds]).toEqual(["loaded-m5"]);
  });

  test("keeps a newest message the loaded transcript already contains", () => {
    const newest = message("loaded", 2);
    const { detachedMessageIds } = project(
      [{ ...newest, content: "edited" }],
      history([message("loaded", 1), newest])
    );
    expect(detachedMessageIds.size).toBe(0);
  });

  test("never shows a bootstrap preview row before the first history page", () => {
    const { detachedMessageIds } = project([message("loaded", 4)], history([], 0));
    expect([...detachedMessageIds]).toEqual(["loaded-m4"]);
  });

  test("treats an unloaded channel's newest message as its preview", () => {
    const { snapshot, detachedMessageIds } = project([message("preview", 3)], history([]));
    expect(snapshot.channelMessages.map(({ id }) => id)).toContain("preview-m3");
    expect(detachedMessageIds.has("preview-m3")).toBe(false);
  });
});
