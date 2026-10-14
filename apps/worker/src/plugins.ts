import type { PluginDynamicNamespace } from "@openteam/contracts";
import {
  connectionNamespace,
  fileTransferCapabilities,
  parsePluginRuntimeComponents,
  pluginWorkflowRoot,
  skillIsForAgent,
  type PluginRuntimePackage,
  type PluginSkillAgent,
} from "@openteam/plugin-sdk";
import { PLUGIN_WORKFLOW_HOST_CONTEXT } from "@openteam/contracts/plugin-workflows";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { PrismaClient } from "@openteam/db";

type JsonObject = Record<string, unknown>;

const objectValue = (value: unknown): JsonObject =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};

const runtimeStatus = (status: string): PluginDynamicNamespace["namespaceStatus"] => {
  if (status === "ready") return "ready";
  if (status === "needs_auth") return "needsAuth";
  if (status === "error") return "error";
  return "loading";
};

const namespaceName = (pluginKey: string, alias: string): string =>
  `${pluginKey.replaceAll("-", "_")}_${alias.replace(/[^A-Za-z0-9_]+/g, "_")}`;

type Installation = Awaited<ReturnType<PrismaClient["pluginInstallation"]["findMany"]>>[number];

type SkillCache = {
  packages?: Array<{ pluginId?: unknown; pluginVersion?: unknown; revision?: unknown; installPath?: unknown }>;
  skills?: Array<{ name?: unknown; installPath?: unknown; filePath?: unknown }>;
};

const agentDataRoot = (): string => process.env.OPENTEAM_AGENT_DATA_ROOT ?? "/agent-data";

const readSkillCache = (): Promise<SkillCache> =>
  readFile(join(agentDataRoot(), "plugin-skills/cache.json"), "utf8")
    .then((text) => JSON.parse(text) as SkillCache)
    .catch(() => ({}));

// Must match the revision the plugin service gives each package it writes to the cache.
const packageRevision = (manifest: JsonObject): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        version: manifest.version ?? "0",
        skills: manifest.skills,
        files: manifest.files,
        binaryFiles: manifest.binaryFiles,
      })
    )
    .digest("hex")
    .slice(0, 16);

const cachedPackage = (
  cache: SkillCache,
  pluginId: string,
  version: string,
  revision?: string
): { installPath: string } | undefined =>
  (cache.packages ?? []).find(
    (entry): entry is { installPath: string } =>
      entry.pluginId === pluginId &&
      entry.pluginVersion === version &&
      (revision === undefined || entry.revision === revision) &&
      typeof entry.installPath === "string"
  );

const cachedSkillPath = (
  cache: SkillCache,
  installed: { installPath: string } | undefined,
  name: string
): string | undefined => {
  if (!installed) return undefined;
  const record = (cache.skills ?? []).find(
    (entry) => entry.installPath === installed.installPath && entry.name === name
  );
  return typeof record?.filePath === "string" ? record.filePath : undefined;
};

const PLUGIN_SKILL_CATALOG_GUIDANCE =
  "Each catalog entry is a skill from an installed plugin, with its SKILL.md path on this computer. Before work a skill covers, Read that file and follow it; resolve its relative links from the file's directory. Executors and other subagents receive no skill catalog: when you delegate work a skill covers, put the skill's path in the Task prompt and tell the subagent to Read it before starting.";

// The main agent gets a catalog of each skill's name, description and SKILL.md
// path, read on demand like managed and saved skills. An agent a skill names
// explicitly gets its full text, as does any skill whose files are not on the
// computer yet. Private skills are enabled per Bot and stay with its main agent.
const renderSkillInstructions = async (
  prisma: PrismaClient,
  botId: string,
  installations: Installation[],
  agent: PluginSkillAgent | null
): Promise<string> => {
  if (!agent) return "";
  const root = agentDataRoot();
  const cache = agent === "main" ? await readSkillCache() : {};
  const catalog: string[] = [];
  const fullText: string[] = [];
  for (const installation of installations) {
    const manifest = objectValue(installation.manifest);
    if (!Array.isArray(manifest.skills)) continue;
    const installed =
      agent === "main"
        ? cachedPackage(cache, installation.pluginKey, installation.version, packageRevision(manifest))
        : undefined;
    for (const candidate of manifest.skills) {
      const skill = objectValue(candidate);
      if (typeof skill.name !== "string" || typeof skill.body !== "string") continue;
      if (!skillIsForAgent(skill, agent)) continue;
      const description = typeof skill.description === "string" ? skill.description : "";
      const path = cachedSkillPath(cache, installed, skill.name);
      if (path) {
        catalog.push(`- ${skill.name} (plugin:${installation.pluginKey}): ${description}\n  Path: ${path}`);
        continue;
      }
      fullText.push(
        `### ${installation.name}: ${skill.name}\n${description ? `${description}\n\n` : ""}${skill.body}\n\nSupporting files: find pluginId ${JSON.stringify(installation.pluginKey)} and skill ${JSON.stringify(skill.name)} in ${root}/plugin-skills/cache.json. Resolve relative file links from that SKILL.md directory.`
      );
    }
  }
  if (agent === "main") {
    const privateSkills = await prisma.pluginPrivateSkill.findMany({
      where: { enabledBotIds: { array_contains: [botId] } },
    });
    for (const skill of privateSkills) {
      const pluginId = `private-${skill.id}`;
      const path = cachedSkillPath(
        cache,
        cachedPackage(cache, pluginId, skill.updatedAt instanceof Date ? skill.updatedAt.toISOString() : ""),
        skill.name
      );
      if (path) {
        catalog.push(`- ${skill.name} (private skill): ${skill.description}\n  Path: ${path}`);
        continue;
      }
      fullText.push(
        `### Private skill: ${skill.name}\n${skill.description}\n\n${skill.body}\n\nSupporting files: find pluginId ${JSON.stringify(pluginId)} in ${root}/plugin-skills/cache.json and resolve links from its SKILL.md directory.`
      );
    }
  }
  if (!catalog.length && !fullText.length) return "";
  return `\n\n## Installed plugin skills\n\n${[
    PLUGIN_WORKFLOW_HOST_CONTEXT,
    ...(catalog.length ? [PLUGIN_SKILL_CATALOG_GUIDANCE, catalog.join("\n\n")] : []),
    ...fullText,
  ].join("\n\n")}`;
};

/** Skill text alone, for workers that receive no plugin tools or runtime packages. */
export const pluginSkillInstructions = async (
  prisma: PrismaClient,
  botId: string,
  agent: PluginSkillAgent | null
): Promise<string> =>
  renderSkillInstructions(
    prisma,
    botId,
    await prisma.pluginInstallation.findMany({ where: { status: "installed" } }),
    agent
  );

export const pluginRuntimeContext = async (
  prisma: PrismaClient,
  botId: string,
  agent: PluginSkillAgent | null = "main"
): Promise<{
  dynamicNamespaces: PluginDynamicNamespace[];
  skillInstructions: string;
  pluginRuntimePackages: PluginRuntimePackage[];
}> => {
  const [connections, installations] = await Promise.all([
    prisma.pluginConnection.findMany({
      where: { status: { in: ["ready", "needs_auth", "error"] },
        installation: { status: "installed" } },
      include: { installation: true }, orderBy: { createdAt: "asc" },
    }),
    prisma.pluginInstallation.findMany({where:{status:"installed"}}),
  ]);

  const dynamicNamespaces: PluginDynamicNamespace[] = connections.map((connection) => ({
    name: connectionNamespace(connection.id, connection.alias),
    description: `${connection.installation.name}: ${connection.name} (${connection.alias})${connection.instructions ? `\n${connection.instructions}` : ""}`,
    namespaceStatus: runtimeStatus(connection.status),
    ...(connection.status !== "ready" && connection.statusMessage
      ? { statusMessage: connection.statusMessage.slice(0, 500) }
      : {}),
    fileTransfers: fileTransferCapabilities(connection.installation.pluginKey),
    tools: Array.isArray(connection.toolSnapshot)
      ? connection.toolSnapshot.flatMap((candidate) => {
          const tool = objectValue(candidate);
          if (
            typeof tool.name !== "string"
          )
            return [];
          return [
            {
              connectionId: connection.id,
              name: tool.name,
              description: typeof tool.description === "string" ? tool.description : "",
              inputSchema: objectValue(tool.inputSchema),
              source: `${connection.installation.pluginKey}/${connection.connectorKey}`,
            },
          ];
        })
      : [],
  }));

  const cache = await readSkillCache();
  const pluginRuntimePackages: PluginRuntimePackage[] = [];
  for (const installation of installations) {
    const manifest = objectValue(installation.manifest);
    const files = objectValue(manifest.files) as Record<string, string>;
    const components = parsePluginRuntimeComponents(files);
    if (
      ![components.hooks, components.rules, components.commands, components.agents].some(
        (items) => items.length
      )
    )
      continue;
    const installed = cachedPackage(
      cache,
      installation.pluginKey,
      installation.version,
      packageRevision(manifest)
    );
    if (!installed)
      throw new Error(
        `Plugin runtime cache is unavailable for ${installation.pluginKey}; reinstall or refresh the plugin`
      );
    const desktopOnly =
      Array.isArray(manifest.connections) &&
      manifest.connections.length > 0 &&
      manifest.connections.every(
        (connection: any) => objectValue(connection.configuration).runtime === "desktop"
      );
    pluginRuntimePackages.push({
      ...components,
      key: installation.pluginKey,
      installPath: join(installed.installPath, pluginWorkflowRoot(files)),
      ...(desktopOnly && components.hooks.length
        ? {
            hooksUnavailableReason:
              "This plugin's hooks validate the connected desktop filesystem and cannot run on the Bot computer. They are preserved but inactive here.",
          }
        : {}),
    });
  }
  return {
    dynamicNamespaces,
    pluginRuntimePackages,
    skillInstructions: await renderSkillInstructions(prisma, botId, installations, agent),
  };
};
