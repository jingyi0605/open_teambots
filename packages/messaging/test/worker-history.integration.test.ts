import { expect, test } from "bun:test";
import { createPrismaClient } from "@openteam/db";
import { readAgentActivity } from "../src/read-agent-activity";
import { readTranscript } from "../src/read-transcript";

const url = process.env.OPENTEAM_TEST_DATABASE_URL;

test.skipIf(!url)("executor and knowledgeWork read their own run and the user's other bots, never the parent or other workers", async () => {
  const db = createPrismaClient(url!);
  const botIds: string[] = [];
  const channelIds: string[] = [];
  const bot = async (name: string, description = "") => {
    const created = await db.bot.create({ data: { name, description, status: "active", defaultDirectory: "/tmp/worker-history", conversation: { create: {} } }, include: { conversation: true } });
    botIds.push(created.id);
    return created;
  };
  const mainChat = async (botId: string) => {
    const channel = await db.channel.create({ data: { kind: "bot_dm", name: "main", directKey: `bot:${botId}`, members: { create: { botId, ordinal: 0 } } } });
    channelIds.push(channel.id);
    return channel;
  };
  try {
    const parent = await bot("Parent fixture");
    const parentChat = await mainChat(parent.id);
    const parentSession = await db.contextSession.create({ data: { botId: parent.id, scope: "channel", scopeId: parentChat.id } });
    await db.channelMessage.create({ data: { channelId: parentChat.id, sender: "user", content: "PARENT_MAIN_CHAT" } });
    const ask = await db.message.create({ data: { botId: parent.id, conversationId: parent.conversation!.id, role: "user", content: "fixture" } });
    const parentRun = await db.run.create({ data: { botId: parent.id, conversationId: parent.conversation!.id, userMessageId: ask.id, channelId: parentChat.id, status: "running" } });
    const worker = async (subagentType: string) => {
      const child = await bot(`${subagentType} worker`);
      await db.subagent.create({ data: { parentBotId: parent.id, childBotId: child.id, parentRunId: parentRun.id, parentChannelId: parentChat.id, launchCallId: crypto.randomUUID(), description: "fixture", prompt: "WORKER_TASK", subagentType, outputPath: "/tmp/unused", status: "running" } });
      const task = await db.message.create({ data: { botId: child.id, conversationId: child.conversation!.id, role: "user", content: `${subagentType}_TASK` } });
      const run = await db.run.create({ data: { botId: child.id, conversationId: child.conversation!.id, userMessageId: task.id, status: "running" } });
      await db.runItem.create({ data: { runId: run.id, kind: "command", status: "completed", content: { type: "commandExecution", command: "echo OWN_RUN", result: { content: [{ type: "text", text: "OWN_RUN" }] } } } });
      return child;
    };
    const knowledge = await worker("knowledgeWork");
    const executor = await worker("executor");
    const graphical = await worker("computerUse");

    const peer = await bot("Peer fixture", "Tracks the hiring plan.");
    const peerChat = await mainChat(peer.id);
    await db.channelMessage.create({ data: { channelId: peerChat.id, sender: "user", content: "PEER_VISIBLE", createdAt: new Date(Date.now() - 3_600_000) } });
    await db.channelMessage.create({ data: { channelId: peerChat.id, sender: "agent", senderBotId: peer.id, content: "Draft is ready. Should I send it to Dana?" } });
    await db.todoItem.createMany({ data: [
      { botId: peer.id, id: "t1", content: "Send the hiring plan", status: "in_progress", position: 0 },
      { botId: peer.id, id: "t2", content: "DONE_TODO", status: "completed", position: 1 },
    ] });
    const stale = await bot("Stale fixture");
    const staleChat = await mainChat(stale.id);
    await db.channelMessage.create({ data: { channelId: staleChat.id, sender: "user", content: "STALE", createdAt: new Date(Date.now() - 10 * 86_400_000) } });

    // Their own run, including tool activity, with no target.
    for (const child of [knowledge, executor]) {
      const own = await readTranscript(db, { botId: child.id, channelId: null }, {});
      expect(JSON.stringify(own)).toContain("OWN_RUN");
      expect(JSON.stringify(own)).not.toContain("PARENT_MAIN_CHAT");
    }
    // The user's other bots by agent_id, messages only; never the parent, other workers, or the parent's main chat.
    const peerRead = await readTranscript(db, { botId: knowledge.id, channelId: null }, { agent_id: peer.id });
    expect(JSON.stringify(peerRead)).toContain("PEER_VISIBLE");
    await expect(readTranscript(db, { botId: knowledge.id, channelId: null }, { agent_id: parent.id })).rejects.toThrow("not available");
    await expect(readTranscript(db, { botId: knowledge.id, channelId: null }, { session_id: parentSession.id })).rejects.toThrow("not available");
    await expect(readTranscript(db, { botId: knowledge.id, channelId: null }, { subagent_id: crypto.randomUUID() })).rejects.toThrow("You dispatch no subagents");
    // Workers without history tools read nothing.
    await expect(readTranscript(db, { botId: graphical.id, channelId: null }, {})).rejects.toThrow("not available");

    // Activity covers the user's other bots, not the asking bot, and only recent ones.
    const activity = await readAgentActivity(db, { botId: parent.id }, { since_hours: 72 });
    expect(activity).toContain(`## Peer fixture (agent ${peer.id})`);
    expect(activity).toContain("Tracks the hiring plan.");
    expect(activity).toContain("Open todos (1):\n- [in_progress] Send the hiring plan");
    expect(activity).not.toContain("DONE_TODO");
    expect(activity).toContain("Pending questions (1):");
    expect(activity).toContain("Should I send it to Dana?");
    expect(activity).toContain("User: PEER_VISIBLE\nPeer fixture: Draft is ready. Should I send it to Dana?");
    expect(activity).not.toContain("Parent fixture (agent");
    expect(activity).not.toContain("Stale fixture");
    expect(activity).not.toContain("worker (agent");
  } finally {
    await db.bot.deleteMany({ where: { id: { in: botIds } } });
    await db.channel.deleteMany({ where: { id: { in: channelIds } } });
    await db.$disconnect();
  }
}, 20_000);
