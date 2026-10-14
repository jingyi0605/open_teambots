import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentDataStore } from "@openteam/messaging";
import { pluginRuntimeContext, pluginSkillInstructions } from "../src/plugins";

const updatedAt = new Date("2026-10-14T12:00:00.000Z");
const manifest = {
  key: "fixture",
  name: "Fixture",
  version: "1",
  publisher: "OpenTeam",
  files: { "skills/main-only/reference.md": "Reference notes." },
  skills: [
    { name: "main-only", description: "Main", body: "Main agent workflow.", path: "skills/main-only" },
    {
      name: "sign-in",
      description: "Sign in",
      body: "Shared sign-in workflow.",
      path: "skills/sign-in",
      agents: ["main", "browserUse", "computerUse"],
    },
  ],
};
const installation = { name: "Fixture", pluginKey: "fixture", version: "1", status: "installed", manifest };
const privateSkill = {
  id: "private",
  name: "Private",
  description: "Private",
  body: "Private workflow.",
  updatedAt,
};
const prisma = {
  pluginConnection: { findMany: async () => [] },
  pluginInstallation: { findMany: async () => [installation] },
  pluginPrivateSkill: { findMany: async () => [privateSkill] },
} as any;

let root = "";
const previousRoot = process.env.OPENTEAM_AGENT_DATA_ROOT;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "openteam-skill-catalog-"));
  process.env.OPENTEAM_AGENT_DATA_ROOT = root;
});
afterEach(async () => {
  if (previousRoot === undefined) delete process.env.OPENTEAM_AGENT_DATA_ROOT;
  else process.env.OPENTEAM_AGENT_DATA_ROOT = previousRoot;
  await rm(root, { recursive: true, force: true });
});

// Mirrors the plugin service's cache sync for one package and one private skill.
const syncCache = () =>
  new AgentDataStore({} as never, { root, workspaceRoot: join(root, "workspace") }).syncPluginSkillCache([
    {
      id: manifest.key,
      name: manifest.name,
      version: manifest.version,
      publisher: manifest.publisher,
      skills: manifest.skills,
      files: manifest.files,
    },
    {
      id: `private-${privateSkill.id}`,
      name: privateSkill.name,
      version: updatedAt.toISOString(),
      publisher: "Private",
      skills: [{ ...privateSkill, path: "skills/private" }],
      files: {},
    },
  ]);

const catalogPath = (instructions: string, entry: string): string => {
  const match = instructions.match(
    new RegExp(`^- ${entry}\\n  Path: (.+/SKILL\\.md)$`, "m")
  );
  if (!match?.[1]) throw new Error(`Missing catalog entry: ${entry}`);
  return match[1];
};

test("the main agent lists plugin skills by path and reads them on demand", async () => {
  await syncCache();
  const main = (await pluginRuntimeContext(prisma, "bot", "main")).skillInstructions;

  expect(main).toContain("## Installed plugin skills");
  expect(main).toContain("put the skill's path in the Task prompt");
  for (const body of ["Main agent workflow.", "Shared sign-in workflow.", "Private workflow."])
    expect(main).not.toContain(body);
  const mainOnly = catalogPath(main, "main-only \\(plugin:fixture\\): Main");
  expect(await readFile(mainOnly, "utf8")).toContain("Main agent workflow.");
  expect(await readFile(join(mainOnly, "../reference.md"), "utf8")).toBe("Reference notes.");
  expect(await readFile(catalogPath(main, "sign-in \\(plugin:fixture\\): Sign in"), "utf8")).toContain(
    "Shared sign-in workflow."
  );
  expect(await readFile(catalogPath(main, "Private \\(private skill\\): Private"), "utf8")).toContain(
    "Private workflow."
  );
});

test("agents a skill names keep its full text, and executors get no catalog", async () => {
  await syncCache();
  for (const agent of ["browserUse", "computerUse"] as const) {
    const worker = await pluginSkillInstructions(prisma, "child", agent);
    expect(worker).toContain("Shared sign-in workflow.");
    expect(worker).not.toContain("Path:");
    expect(worker).not.toContain("Main agent workflow.");
  }
  expect((await pluginRuntimeContext(prisma, "parent", "executor")).skillInstructions).toBe("");
});

test("skills whose files are not on the computer yet keep their full text", async () => {
  const main = (await pluginRuntimeContext(prisma, "bot", "main")).skillInstructions;
  expect(main).toContain("Main agent workflow.");
  expect(main).toContain("Private workflow.");
  expect(main).not.toContain("Path:");
});
