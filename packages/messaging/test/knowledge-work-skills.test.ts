import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import manifest from "../reference/builtins-2026-10-11/manifest.json";
import parity from "../reference/builtins-2026-10-11-parity.json";
import managed from "../src/prompts/managed-skills.json";
import { AgentDataStore } from "../src/agent-data";
import { subagentSpecializationInstructions } from "../src/index";
import { renderPlatformBaseSystemPrompt } from "../src/platform-system-prompt";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const installed = (id: string) => managed.skills.find((skill) => skill.id === id) as
  | { id: string; content: string; agents?: string[] }
  | undefined;

test("deck skills keep their originals byte for byte and record every adaptation", async () => {
  expect(manifest.skills.map((skill) => skill.id)).toEqual(["slides", "slides-executor", "office-pptx"]);
  for (const source of manifest.skills) {
    const original = await readFile(
      join(import.meta.dir, "../reference/builtins-2026-10-11/skills", source.id, "SKILL.md"),
      "utf8"
    );
    expect(sha256(original)).toBe(source.sha256);
    const record = parity.skills.find((skill) => skill.id === source.id)!;
    const copy = installed(source.id)!;
    expect(record.sourceSha256).toBe(source.sha256);
    expect(sha256(copy.content)).toBe(record.installedSha256);
    expect(record.status).toBe(copy.content === original ? "verbatim" : "adapted");
    expect(copy.agents ?? ["main"]).toEqual(record.agents);
  }
  const original = await readFile(join(import.meta.dir, "../reference/builtins-2026-10-11/skills/slides/SKILL.md"), "utf8");
  // The main-agent playbook differs only in OpenTeam's names for the connector file tools.
  expect(original.replaceAll("`DownloadFile`", "`download_file`").replaceAll("`UploadFile`", "`upload_file`")).toBe(
    installed("slides")!.content
  );
});

test("knowledgeWork skills stay out of the main agent's catalog and workflow list", async () => {
  const root = await mkdtemp(join(tmpdir(), "openteam-kw-skills-"));
  try {
    const store = new AgentDataStore({} as never, { root: join(root, "data"), workspaceRoot: join(root, "workspace") });
    await store.syncPluginSkillCache([]);
    const cache = JSON.parse(await readFile(join(root, "data/managed-skills/cache.json"), "utf8"));
    const record = (id: string) => cache.skills.find((skill: { id: string }) => skill.id === id);
    expect(record("slides-executor").agents).toEqual(["knowledgeWork"]);
    expect(record("office-pptx").agents).toEqual(["knowledgeWork"]);
    expect(record("slides").agents).toBeUndefined();
    const catalog: string = await (store as any).renderManagedSkills();
    expect(catalog).toContain("managed:slides)");
    expect(catalog).not.toContain("managed:slides-executor");
    expect(catalog).not.toContain("managed:office-pptx");
    // The knowledgeWork worker gets its own skills as an agent_skills block with file paths.
    const description = (id: string) => record(id).description;
    expect(await store.renderWorkerSkillCatalog("knowledgeWork")).toBe(
      [
        "<agent_skills>",
        "When users ask you to perform tasks, check if any of the available skills below can help complete the task more effectively. Skills provide specialized capabilities and domain knowledge. To use a skill, read the skill file at the provided absolute path using the Read tool, then follow the instructions within. When a skill is relevant, read and follow it IMMEDIATELY as your first action. NEVER just announce or mention a skill without actually reading and following it. Only use skills listed below.",
        "",
        "",
        '<available_skills description="Skills the agent can use. Use the Read tool with the provided absolute path to fetch full contents.">',
        `<agent_skill fullPath="${record("slides-executor").filePath}">${description("slides-executor")}</agent_skill>`,
        "",
        `<agent_skill fullPath="${record("office-pptx").filePath}">${description("office-pptx")}</agent_skill>`,
        "</available_skills>",
        "</agent_skills>",
      ].join("\n")
    );
    expect(await store.renderWorkerSkillCatalog("executor")).toBe("");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  const workflows = renderPlatformBaseSystemPrompt().match(/## Managed workflows\n[^\n]*/)?.[0] ?? "";
  expect(workflows).toContain("slides");
  expect(workflows).not.toContain("slides-executor");
  expect(workflows).not.toContain("office-pptx");
});

test("the knowledgeWork worker reads its own skills from its agent_skills section", () => {
  const instructions = subagentSpecializationInstructions("knowledgeWork");
  expect(instructions).toContain("in the agent_skills section of these instructions");
  expect(subagentSpecializationInstructions("executor")).not.toContain("agent_skills");
});
