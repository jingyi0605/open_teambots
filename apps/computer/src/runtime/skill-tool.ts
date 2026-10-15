import { readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { type AgentToolResult, defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export const SKILL_TOOL_NAME = "Skill";

const SKILL_TOOL_USAGE = [
  "Load one of your skills by name and get its instructions.",
  "Returns the SKILL.md body without its frontmatter. Unless the result says there is nothing more to read, it also names the skill's directory and any helper files your skill store lists beside it. Its instructions name the helper files they use; do not guess at other file names.",
  "Call this instead of reading a SKILL.md with Read, then follow the instructions. Relative paths in a skill resolve against its directory; open a helper file with Read.",
  "When a skill below fits the task, load it before acting on the task; do not just mention it.",
].join("\n");

const NAME_DESCRIPTION =
  "The skill's name as this tool's skill list gives it, or the name in its frontmatter. The list gives a skill by its path when another skill shares its name; pass that path.";

export interface AgentSkill {
  name: string;
  description: string;
  filePath: string;
}

const agentDataRoot = () => process.env.OPENTEAM_AGENT_DATA_ROOT ?? "/home/box/agent-data";

/** Managed skills whose catalog record names this agent. */
export const agentSkills = (agent: string, root = agentDataRoot()): AgentSkill[] => {
  let cache: { skills?: unknown };
  try {
    cache = JSON.parse(readFileSync(join(root, "managed-skills", "cache.json"), "utf8"));
  } catch {
    return [];
  }
  if (!Array.isArray(cache.skills)) return [];
  return cache.skills.flatMap((record) => {
    const skill = record as Record<string, unknown>;
    return Array.isArray(skill.agents) &&
      skill.agents.includes(agent) &&
      typeof skill.name === "string" &&
      typeof skill.description === "string" &&
      typeof skill.filePath === "string"
      ? [{ name: skill.name, description: skill.description, filePath: skill.filePath }]
      : [];
  });
};

const listedName = (skill: AgentSkill, skills: readonly AgentSkill[]) =>
  skills.filter((other) => other.name === skill.name).length > 1 ? skill.filePath : skill.name;

export const skillToolDescription = (skills: readonly AgentSkill[]): string =>
  [
    SKILL_TOOL_USAGE,
    "",
    ...(skills.length
      ? skills.map((skill) => `- ${listedName(skill, skills)}: ${skill.description}`)
      : ["You have no skills to load."]),
  ].join("\n");

const stripFrontmatter = (content: string) =>
  content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").replace(/^\s+/, "");

const helperFiles = async (directory: string): Promise<string[]> => {
  const found: string[] = [];
  const walk = async (current: string) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (relative(directory, path) !== "SKILL.md") found.push(relative(directory, path));
    }
  };
  await walk(directory);
  return found.sort();
};

export const loadSkill = async (skills: readonly AgentSkill[], requested: string): Promise<string> => {
  const name = requested.trim();
  const byPath = skills.filter((skill) => skill.filePath === name);
  const matches = byPath.length ? byPath : skills.filter((skill) => skill.name === name);
  if (!matches.length)
    throw new Error(
      `No skill named "${name}". Your skills: ${skills.map((skill) => listedName(skill, skills)).join(", ") || "none"}.`
    );
  if (matches.length > 1)
    throw new Error(
      `More than one skill is named "${name}". Pass one of these paths: ${matches.map((skill) => skill.filePath).join(", ")}.`
    );
  const skill = matches[0]!;
  const body = stripFrontmatter(await readFile(skill.filePath, "utf8"));
  const directory = dirname(skill.filePath);
  const helpers = await helperFiles(directory);
  return helpers.length
    ? `${body.trimEnd()}\n\nSkill directory: ${directory}\nHelper files: ${helpers.join(", ")}`
    : `${body.trimEnd()}\n\nThere is nothing more to read.`;
};

/** The Skill tool for a worker that carries skills of its own. */
export const skillTool = (agent: string) => {
  const skills = agentSkills(agent);
  return defineTool({
    name: SKILL_TOOL_NAME,
    label: SKILL_TOOL_NAME,
    description: skillToolDescription(skills),
    parameters: Type.Object({ name: Type.String({ minLength: 1, description: NAME_DESCRIPTION }) }),
    executionMode: "parallel",
    execute: async (_callId, args): Promise<AgentToolResult<Record<string, unknown>>> => ({
      content: [{ type: "text", text: await loadSkill(skills, String((args as { name?: unknown }).name ?? "")) }],
      details: {},
    }),
  });
};
