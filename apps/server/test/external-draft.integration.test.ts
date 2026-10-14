import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createPrismaClient } from '@openteam/db';
import { AgentDataStore, AgentMessaging } from '@openteam/messaging';
import { Effect } from 'effect';
import { ExternalDraftService } from '../src/services/external-draft-service';
const databaseUrl = process.env.OPENTEAM_TEST_DATABASE_URL;
test('reviewed drafts verify accounts, persist edits, reject route changes and send at most once', async () => {
 if (!databaseUrl) return;
 const prisma = createPrismaClient(databaseUrl); const root = await mkdtemp(join(tmpdir(), 'draft-e2e-'));
 const botId = crypto.randomUUID(), conversationId = crypto.randomUUID(), channelId = crypto.randomUUID(), runId = crypto.randomUUID();
 const data = new AgentDataStore(prisma, { root: join(root, 'data'), workspaceRoot: root });
 const messaging = new AgentMessaging(prisma, { send: async () => crypto.randomUUID(), sendDebounced: async () => crypto.randomUUID() } as never, data);
 const sent: Array<{ toolName: string; arguments: any }> = []; let sender = 'author@example.com'; let uncertain = false;
 const plugins = {
  invoke: async (input: any) => {
   if (input.toolName === 'get_message') return { subject: 'Original' };
   if (input.toolName === 'search_threads') return { threads: [{ messages: [{ sender, labelIds: ['SENT'] }] }] };
   sent.push(input); if (uncertain) throw new Error('Connection lost after remote side effect'); return { id: 'provider-message-id' };
  },
 };
 const service = new ExternalDraftService(prisma, messaging, plugins as never);
 try {
  await prisma.bot.create({ data: { id: botId, name: 'Draft fixture', defaultDirectory: root, status: 'active', onboardingStatus: 'completed', conversation: { create: { id: conversationId } } } });
  await prisma.channel.create({ data: { id: channelId, kind: 'bot_dm', directKey: `bot:${botId}`, name: 'Draft fixture', members: { create: { botId, ordinal: 0 } } } });
  const user = await prisma.message.create({ data: { botId, conversationId, role: 'user', content: 'Draft an email', clientId: 'fixture', status: 'completed' } });
  await prisma.run.create({ data: { id: runId, botId, conversationId, channelId, userMessageId: user.id, status: 'running', origin: 'user' } });
  await data.initializeBot(botId); await data.writeRootSettings({});
  const context = { runId, botId, conversationId, channelId, deliveryId: null, origin: 'user' as const, callId: 'draft-a', isFork: false, replyToMessageId: null };
  const draft = { platform: 'email', providerIdentifier: 'synthetic-connector', from: sender, to: ['recipient@example.com'], subject: 'Subject', body: 'First body' };
  const card = await service.create(context, draft) as { message_id: string };
  expect(sent).toHaveLength(0);
  await expect(Effect.runPromise(service.mutate(card.message_id, { action: 'send', edits: { providerIdentifier: 'different' } }))).rejects.toThrow('cannot be changed');
  const results = await Promise.all([Effect.runPromise(service.mutate(card.message_id, { action: 'send', edits: { body: 'Human edited body', to: ['edited@example.com'] } })), Effect.runPromise(service.mutate(card.message_id, { action: 'send' }))]);
  expect(sent).toHaveLength(1); expect(sent[0]!.arguments).toMatchObject({ body: 'Human edited body', to: ['edited@example.com'] });
  expect(results.some((result) => (result.message.metadata as any).cardState === 'sent')).toBe(true);
  expect(await prisma.inboxEvent.count({ where: { botId, type: 'draft.response' } })).toBe(1);
  const stale = await service.create({ ...context, callId: 'draft-b' }, draft) as { message_id: string };
  sender = 'different@example.com';
  expect((await Effect.runPromise(service.mutate(stale.message_id, { action: 'send' }))).message.metadata).toMatchObject({ cardState: 'failed' }); expect(sent).toHaveLength(1);
  sender = draft.from;
  const interrupted = await service.create({ ...context, callId: 'draft-c' }, draft) as { message_id: string };
  uncertain = true;
  expect((await Effect.runPromise(service.mutate(interrupted.message_id, { action: 'send' }))).message.metadata).toMatchObject({ cardState: 'unknown' });
  await Effect.runPromise(service.mutate(interrupted.message_id, { action: 'send' })); expect(sent).toHaveLength(2);
  const reply = await service.create({ ...context, callId: 'draft-d' }, { ...draft, replyToMessageId: 'original' }) as { message_id: string };
  uncertain = false;
  await Effect.runPromise(service.mutate(reply.message_id, { action: 'send' }));
  expect(sent.slice(-2).map((item) => item.toolName)).toEqual(['create_draft', 'send_message']); expect(sent.at(-1)!.arguments).toEqual({ draftId: 'provider-message-id' });
 } finally { await prisma.bot.deleteMany({ where: { id: botId } }); await prisma.channel.deleteMany({ where: { id: channelId } }); await prisma.$disconnect(); await rm(root, { recursive: true, force: true }); }
});

test('connectors that declare reviewed sending verify and send drafts through their host-only tool', async () => {
 if (!databaseUrl) return;
 const prisma = createPrismaClient(databaseUrl); const root = await mkdtemp(join(tmpdir(), 'draft-host-'));
 const botId = crypto.randomUUID(), conversationId = crypto.randomUUID(), channelId = crypto.randomUUID(), runId = crypto.randomUUID();
 const pluginKey = `mail-${crypto.randomUUID().slice(0, 8)}`;
 const data = new AgentDataStore(prisma, { root: join(root, 'data'), workspaceRoot: root });
 const messaging = new AgentMessaging(prisma, { send: async () => crypto.randomUUID(), sendDebounced: async () => crypto.randomUUID() } as never, data);
 const calls: any[] = []; let identity = 'bot@example.com';
 const plugins = { invoke: async (input: any) => { calls.push(input); return input.arguments.action === 'verify' ? { identity, thread: 'Invoice question' } : { messageId: '<sent@example.com>', accepted: ['alice@example.com'] }; } };
 const service = new ExternalDraftService(prisma, messaging, plugins as never);
 try {
  const installation = await prisma.pluginInstallation.create({ data: { pluginKey, version: '1.0.0', name: 'Mail', publisher: 'Test', manifest: { key: pluginKey, name: 'Mail', skills: [], connections: [{ key: 'email', transport: 'stdio', drafts: { platform: 'email', tool: 'send_reviewed_email' } }] } } });
  const connection = await prisma.pluginConnection.create({ data: { installationId: installation.id, connectorKey: 'email', name: 'Mail', transport: 'stdio', authType: 'none', status: 'ready' } });
  await prisma.bot.create({ data: { id: botId, name: 'Draft host fixture', defaultDirectory: root, status: 'active', onboardingStatus: 'completed', conversation: { create: { id: conversationId } } } });
  await prisma.channel.create({ data: { id: channelId, kind: 'bot_dm', directKey: `bot:${botId}`, name: 'Draft host fixture', members: { create: { botId, ordinal: 0 } } } });
  const user = await prisma.message.create({ data: { botId, conversationId, role: 'user', content: 'Reply to the email', clientId: 'fixture', status: 'completed' } });
  await prisma.run.create({ data: { id: runId, botId, conversationId, channelId, userMessageId: user.id, status: 'running', origin: 'routine' } });
  await data.initializeBot(botId); await data.writeRootSettings({});
  const context = { runId, botId, conversationId, channelId, deliveryId: null, origin: 'user' as const, callId: 'reply-a', isFork: false, replyToMessageId: null };
  const draft = { platform: 'email', providerIdentifier: connection.id, from: 'Bot@Example.com', to: ['alice@example.com'], subject: 'Re: Invoice question', body: 'It is $1,250.', replyToMessageId: 'INBOX:42' };
  const card = await service.create(context, draft) as { message_id: string };
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ connectionId: connection.id, toolName: 'send_reviewed_email', hostTool: true, arguments: { action: 'verify', draft: { from: 'Bot@Example.com', to: ['alice@example.com'], replyToMessageId: 'INBOX:42' } } });
  const stored = await prisma.channelMessage.findUniqueOrThrow({ where: { id: card.message_id } });
  expect((stored.metadata as any).draft.verification).toEqual({ identity: 'bot@example.com', destination: 'alice@example.com', thread: 'Invoice question' });
  await Promise.all([Effect.runPromise(service.mutate(card.message_id, { action: 'send', edits: { body: 'It is $1,250. Thanks!' } })), Effect.runPromise(service.mutate(card.message_id, { action: 'send' }))]);
  const sends = calls.filter((call) => call.arguments.action === 'send');
  expect(sends).toHaveLength(1);
  expect(sends[0]).toMatchObject({ callId: `draft-send:${card.message_id}:send`, hostTool: true, arguments: { draft: { body: 'It is $1,250. Thanks!', replyToMessageId: 'INBOX:42' } } });
  expect(sends[0].arguments.draft.html).toContain('It is $1,250. Thanks!');
  expect(((await prisma.channelMessage.findUniqueOrThrow({ where: { id: card.message_id } })).metadata as any).cardState).toBe('sent');
  identity = 'someone-else@example.com';
  await expect(service.create({ ...context, callId: 'reply-b' }, draft)).rejects.toThrow('does not match the draft From address');
 } finally { await prisma.bot.deleteMany({ where: { id: botId } }); await prisma.channel.deleteMany({ where: { id: channelId } }); await prisma.pluginInstallation.deleteMany({ where: { pluginKey } }); await prisma.$disconnect(); await rm(root, { recursive: true, force: true }); }
});
