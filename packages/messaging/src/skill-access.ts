export type SkillAccess = "read" | "tool";

/** Off by default, like the host's skill tool gate: knowledgeWork Reads its SKILL.md files by path. */
export const workerSkillAccess = (subagentType: string | null | undefined): SkillAccess =>
  subagentType === "knowledgeWork" && process.env.OPENTEAM_SKILL_TOOL === "true" ? "tool" : "read";

/** Where a worker finds its own skills, and how it opens one. */
export const SKILL_ACCESS_COPY: Record<SkillAccess, { catalog: string; load: string }> = {
  read: {
    catalog: "Your skills are cataloged (file path plus a when-to-use description) in the agent_skills section of these instructions.",
    load: "Read a skill's SKILL.md at its listed path with Read before work it covers.",
  },
  tool: {
    catalog: "Your skills are cataloged (name plus a when-to-use description) in the description of the Skill tool.",
    load: "Load a skill with the Skill tool instead of reading a SKILL.md with Read, even where other lines say to Read one.",
  },
};
