import { expect, test } from 'bun:test';
import { prepareGeneralWorkspaceDraft } from './general-chat-preparation';
import type { Workspace } from './model';

const workspace: Workspace = {
  id: 'project',
  name: 'Project',
  description: '',
  folders: [{ id: 'app', path: '/repos/app', role: '' }],
  defaults: { agent: 'retired', model: { providerID: 'old-provider', id: 'old-model' } },
};

test('drops an unavailable saved model while keeping the resolved general-chat agent', async () => {
  const result = await prepareGeneralWorkspaceDraft(workspace, {}, {
    runtimeKey: () => 'runtime',
    supportsGeneralChat: () => true,
    resolveDirectory: async () => '/managed/chats/project',
    checkAccess: async () => ({ kind: 'supported' }),
    loadAgentContext: async () => ({
      defaultAgent: 'plan',
      agents: [{ name: 'plan', mode: 'primary' }],
      availableModels: [{ providerID: 'current-provider', id: 'current-model' }],
    }),
  });

  expect(result.kind).toBe('ready');
  if (result.kind !== 'ready') return;
  expect(result.defaults).toEqual({ agent: 'plan' });
  expect(result.unavailableSavedAgent).toBe('retired');
});
