export const AGENT_ACTIVITY_LIMITS = {
  sinceHours: { fallback: 72, max: 168 },
  maxAgents: { fallback: 10, max: 20 },
  excerptChars: { fallback: 1500, max: 4000 },
} as const;

export const READ_AGENT_ACTIVITY_TOOL = {
  name: "ReadAgentActivity",
  description: "Read a bounded summary of what this user's other bots have been doing recently: per bot, when the user and the bot last spoke, its open todos, questions it asked the user that got no reply, and a short excerpt of the recent conversation, newest last. It sees only bots this user owns, only each bot's main chat (never group chats or threads), and never this bot itself. It is read-only: nothing on the other bots is marked seen, answered, or touched. Use it to decide whether anything across the user's bots is worth raising.",
  inputSchema: { type: "object", properties: {
    since_hours: { type: "number", description: `Only bots with a user or assistant message in the last N hours (default ${AGENT_ACTIVITY_LIMITS.sinceHours.fallback}, capped at ${AGENT_ACTIVITY_LIMITS.sinceHours.max}).` },
    max_agents: { type: "number", description: `Most bots to summarize, most recently active first (default ${AGENT_ACTIVITY_LIMITS.maxAgents.fallback}, capped at ${AGENT_ACTIVITY_LIMITS.maxAgents.max}).` },
    excerpt_chars: { type: "number", description: `Most characters of conversation excerpt per bot (default ${AGENT_ACTIVITY_LIMITS.excerptChars.fallback}, capped at ${AGENT_ACTIVITY_LIMITS.excerptChars.max}).` },
  }, additionalProperties: false },
};

export interface AgentActivityBounds { sinceHours: number; maxAgents: number; excerptChars: number }

// Out-of-range values fall back to the default rather than failing the call.
const clamp = (value: unknown, limit: { fallback: number; max: number }) => {
  const floored = typeof value === "number" ? Math.floor(value) : Number.NaN;
  return Number.isFinite(floored) && floored >= 1 ? Math.min(floored, limit.max) : limit.fallback;
};

export function parseReadAgentActivityInput(raw: unknown): AgentActivityBounds {
  if (raw !== undefined && (!raw || typeof raw !== "object" || Array.isArray(raw))) throw new Error("Expected an object");
  const input = (raw ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(input)) if (!Object.hasOwn(READ_AGENT_ACTIVITY_TOOL.inputSchema.properties, key)) throw new Error(`Unknown field: ${key}`);
  return {
    sinceHours: clamp(input.since_hours, AGENT_ACTIVITY_LIMITS.sinceHours),
    maxAgents: clamp(input.max_agents, AGENT_ACTIVITY_LIMITS.maxAgents),
    excerptChars: clamp(input.excerpt_chars, AGENT_ACTIVITY_LIMITS.excerptChars),
  };
}
