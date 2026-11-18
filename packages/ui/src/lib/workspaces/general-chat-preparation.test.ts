import { describe, expect, test } from 'bun:test';
import { prepareGeneralWorkspaceDraft } from './general-chat-preparation';
import type { Workspace } from './model';

const workspace = (folders: Workspace['folders'] = [
  { id: 'app', path: '/repos/app', role: 'Application code' },
  { id: 'docs', path: '/repos/docs', role: 'Documentation' },
]): Workspace => ({
  id: 'product',
  name: 'Product',
  description: 'Workspace notes',
  folders,
  defaults: { agent: 'retired' },
});

const agents = [
  { name: 'build', mode: 'primary' as const },
  { name: 'review', mode: 'subagent' as const },
];

describe('general workspace draft preparation', () => {
  test('does not resolve a neutral directory when the runtime is unsupported or the workspace has no folders', async () => {
    for (const input of [
      { workspace: workspace(), supportsGeneralChat: false },
      { workspace: workspace([]), supportsGeneralChat: true },
    ]) {
      let resolveDirectoryCalls = 0;
      const result = await prepareGeneralWorkspaceDraft(input.workspace, {}, {
        runtimeKey: () => 'runtime-a',
        supportsGeneralChat: () => input.supportsGeneralChat,
        resolveDirectory: async () => {
          resolveDirectoryCalls += 1;
          return '/managed/chats/product';
        },
        checkAccess: async () => ({ kind: 'supported' }),
        loadAgentContext: async () => ({ agents }),
      });

      expect(result.kind).toBe('unavailable');
      expect(resolveDirectoryCalls).toBe(0);
    }
  });

  test('does not load agent context after linked-folder access is denied', async () => {
    let loadAgentContextCalls = 0;
    const result = await prepareGeneralWorkspaceDraft(workspace(), {}, {
      runtimeKey: () => 'runtime-a',
      supportsGeneralChat: () => true,
      resolveDirectory: async () => '/managed/chats/product',
      checkAccess: async () => ({
        kind: 'unavailable',
        reason: 'folder-unavailable',
        paths: ['/repos/docs'],
      }),
      loadAgentContext: async () => {
        loadAgentContextCalls += 1;
        return { agents };
      },
    });

    expect(result).toEqual({
      kind: 'unavailable',
      reason: 'folder-unavailable',
    });
    expect(loadAgentContextCalls).toBe(0);
  });

  test('stops after neutral-directory resolution when the runtime changes during the await', async () => {
    let currentRuntime = 'runtime-a';
    let finishDirectory!: (directory: string) => void;
    let checkAccessCalls = 0;
    let loadAgentContextCalls = 0;
    const directory = new Promise<string>((resolve) => {
      finishDirectory = resolve;
    });
    const preparation = prepareGeneralWorkspaceDraft(workspace(), {}, {
      runtimeKey: () => currentRuntime,
      supportsGeneralChat: () => true,
      resolveDirectory: () => directory,
      checkAccess: async () => {
        checkAccessCalls += 1;
        return { kind: 'supported' };
      },
      loadAgentContext: async () => {
        loadAgentContextCalls += 1;
        return { agents };
      },
    });

    currentRuntime = 'runtime-b';
    finishDirectory('/managed/chats/product');
    const result = await preparation;

    expect(result.kind).toBe('unavailable');
    expect(checkAccessCalls).toBe(0);
    expect(loadAgentContextCalls).toBe(0);
  });

  test('builds a version 2 scope with every linked folder and draft-only agent fallback', async () => {
    const input = workspace();
    const original = structuredClone(input);
    const neutralAgents = [
      { name: 'catalog-first', mode: 'primary' as const },
      { name: 'configured-default', mode: 'primary' as const },
      ...agents,
    ];
    const result = await prepareGeneralWorkspaceDraft(input, {}, {
      runtimeKey: () => 'runtime-a',
      supportsGeneralChat: () => true,
      resolveDirectory: async () => '/managed/chats/product',
      checkAccess: async (scope) => {
        expect(scope).toEqual({
          version: 2,
          mode: 'general',
          workspaceId: 'product',
          workspaceName: 'Product',
          description: 'Workspace notes',
          primaryDirectory: '/managed/chats/product',
          folders: input.folders,
        });
        return { kind: 'supported' };
      },
      loadAgentContext: async () => ({
        defaultAgent: 'configured-default',
        agents: neutralAgents,
      }),
    });

    expect(result).toEqual({
      kind: 'ready',
      scope: {
        version: 2,
        mode: 'general',
        workspaceId: 'product',
        workspaceName: 'Product',
        description: 'Workspace notes',
        primaryDirectory: '/managed/chats/product',
        folders: input.folders,
      },
      defaults: { agent: 'configured-default' },
      unavailableSavedAgent: 'retired',
    });
    expect(input).toEqual(original);
  });
});
