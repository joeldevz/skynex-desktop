import { z } from 'zod';
import { runtimeFetch } from '../runtime-fetch';
import type { Workspace, WorkspaceDefaults } from './model';
import { snapshotGeneralWorkspaceScope, type WorkspaceSessionScope } from './session-scope';
import { resolveGeneralWorkspaceAgent, type GeneralWorkspaceAgent } from './general-chat-agent';
import { opencodeClient } from '../opencode/client';
import { getRuntimeKey } from '../runtime-switch';
import { isVSCodeRuntime } from '../desktop';
import { checkWorkspaceScopeAccess } from './runtime-policy';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useWorkspacesStore } from '@/stores/useWorkspacesStore';

export type GeneralWorkspaceUnavailableReason =
  | 'runtime-unavailable'
  | 'outside-editor-roots'
  | 'isolated-space-unsupported'
  | 'folder-unavailable';

export class GeneralWorkspaceUnavailableError extends Error {
  constructor(readonly reason: GeneralWorkspaceUnavailableReason, message: string) {
    super(message);
    this.name = 'GeneralWorkspaceUnavailableError';
  }
}

type PreparationDependencies = Readonly<{
  runtimeKey: () => string;
  supportsGeneralChat: () => boolean;
  resolveDirectory: (workspaceId: string) => Promise<string>;
  checkAccess: (scope: WorkspaceSessionScope) => Promise<{ kind: 'supported' } | {
    kind: 'unavailable';
    reason: GeneralWorkspaceUnavailableReason;
    paths?: readonly string[];
  }>;
  loadAgentContext: (directory: string) => Promise<{
    defaultAgent?: string;
    agents: readonly GeneralWorkspaceAgent[];
    availableModels?: readonly { providerID: string; id: string }[];
  }>;
}>;

export type GeneralWorkspacePreparation =
  | { kind: 'ready'; scope: WorkspaceSessionScope; defaults: WorkspaceDefaults; unavailableSavedAgent: string | null }
  | { kind: 'unavailable'; reason?: GeneralWorkspaceUnavailableReason };

export async function prepareGeneralWorkspaceDraft(
  workspace: Workspace,
  overrides: WorkspaceDefaults,
  dependencies: PreparationDependencies,
): Promise<GeneralWorkspacePreparation> {
  if (!dependencies.supportsGeneralChat()) return { kind: 'unavailable', reason: 'runtime-unavailable' };
  if (workspace.folders.length === 0) return { kind: 'unavailable', reason: 'folder-unavailable' };
  const runtimeKey = dependencies.runtimeKey();
  const directory = await dependencies.resolveDirectory(workspace.id);
  if (runtimeKey !== dependencies.runtimeKey()) return { kind: 'unavailable' };
  const scope = snapshotGeneralWorkspaceScope(workspace, directory);
  if (scope.kind === 'invalid') return { kind: 'unavailable' };
  const access = await dependencies.checkAccess(scope.value);
  if (access.kind === 'unavailable') return { kind: 'unavailable', reason: access.reason };
  if (runtimeKey !== dependencies.runtimeKey()) return { kind: 'unavailable' };
  const context = await dependencies.loadAgentContext(directory);
  if (runtimeKey !== dependencies.runtimeKey()) return { kind: 'unavailable' };
  const savedAgent = overrides.agent ?? workspace.defaults.agent;
  const resolution = resolveGeneralWorkspaceAgent(savedAgent, context.defaultAgent, context.agents);
  const defaults = { ...workspace.defaults, ...overrides, agent: resolution.agent ?? undefined };
  if (defaults.model && context.availableModels
    && !context.availableModels.some(({ providerID, id }) => providerID === defaults.model?.providerID && id === defaults.model.id)) {
    delete defaults.model;
  }
  return {
    kind: 'ready',
    scope: scope.value,
    defaults,
    unavailableSavedAgent: resolution.unavailableSavedAgent,
  };
}

export async function prepareGeneralWorkspaceDraftForRuntime(
  workspace: Workspace,
  overrides: WorkspaceDefaults = {},
): Promise<GeneralWorkspacePreparation> {
  const runtimeKey = getRuntimeKey();
  const workspaceState = useWorkspacesStore.getState();
  if (workspaceState.status !== 'ready' || workspaceState.runtimeKey !== runtimeKey
    || !workspaceState.catalog.workspaces.some((entry) => entry.id === workspace.id)) {
    return { kind: 'unavailable' };
  }
  let prepared: GeneralWorkspacePreparation;
  try {
    prepared = await prepareGeneralWorkspaceDraft(workspace, overrides, {
      runtimeKey: getRuntimeKey,
      supportsGeneralChat: () => !isVSCodeRuntime(),
      resolveDirectory: resolveGeneralWorkspaceDirectory,
      checkAccess: (scope) => checkWorkspaceScopeAccess(
        scope,
        useProjectsStore.getState().projects.map((project) => project.path),
      ),
      loadAgentContext: async (directory) => {
        const [config, agents, catalog] = await Promise.all([
          opencodeClient.getConfig(directory),
          opencodeClient.listAgents(directory),
          opencodeClient.getProvidersForConfig(directory),
        ]);
        return {
          defaultAgent: config.default_agent,
          agents: agents.map(({ name, mode, hidden }) => ({ name, mode, hidden })),
          availableModels: catalog.models.map(({ providerID, id }) => ({ providerID, id })),
        };
      },
    });
  } catch {
    return { kind: 'unavailable', reason: 'runtime-unavailable' };
  }
  const latestState = useWorkspacesStore.getState();
  const latestWorkspace = latestState.catalog.workspaces.find((entry) => entry.id === workspace.id);
  if (getRuntimeKey() !== runtimeKey || latestState.runtimeKey !== runtimeKey
    || !latestWorkspace || JSON.stringify(latestWorkspace) !== JSON.stringify(workspace)) {
    return { kind: 'unavailable' };
  }
  return prepared;
}

const generalDirectoryResponseSchema = z.object({ directory: z.string().min(1) }).strict();

async function resolveGeneralWorkspaceDirectory(workspaceId: string): Promise<string> {
  const response = await runtimeFetch('/api/openchamber/workspaces/general-chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workspaceId }),
  });
  if (!response.ok) throw new Error(`General workspace directory request failed: ${response.status}`);
  const result: unknown = await response.json();
  return generalDirectoryResponseSchema.parse(result).directory;
}
