export type GeneralWorkspaceAgent = Readonly<{
  name: string;
  mode: 'primary' | 'subagent' | 'all';
  hidden?: boolean;
}>;

export type GeneralWorkspaceAgentResolution = Readonly<{
  agent: string | null;
  unavailableSavedAgent: string | null;
}>;

export function resolveGeneralWorkspaceAgent(
  savedAgent: string | undefined,
  defaultAgent: string | undefined,
  agents: readonly GeneralWorkspaceAgent[],
): GeneralWorkspaceAgentResolution {
  const eligible = agents.filter((agent) => !agent.hidden && agent.mode !== 'subagent');
  const eligibleNames = new Set(eligible.map(({ name }) => name));
  const unavailableSavedAgent = savedAgent !== undefined && !eligibleNames.has(savedAgent) ? savedAgent : null;

  const agent = savedAgent !== undefined && eligibleNames.has(savedAgent)
    ? savedAgent
    : defaultAgent !== undefined && eligibleNames.has(defaultAgent)
      ? defaultAgent
      : eligibleNames.has('build')
        ? 'build'
        : eligible[0]?.name ?? null;

  return { agent, unavailableSavedAgent };
}
