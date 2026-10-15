/** Agents a managed skill is for. Skills that name none are for the main agent. */
export const managedSkillAgents = (skill: object): string[] | undefined => {
  const agents = (skill as { agents?: unknown }).agents;
  return Array.isArray(agents) && agents.every((agent) => typeof agent === "string")
    ? (agents as string[])
    : undefined;
};

export const managedSkillIsForMain = (skill: object): boolean =>
  managedSkillAgents(skill)?.includes("main") ?? true;
