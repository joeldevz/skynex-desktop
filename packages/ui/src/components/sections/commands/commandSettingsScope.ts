import { create } from 'zustand';

interface CommandSettingsScopeState {
  /** The workspace whose shared commands are being edited, or null while a folder is selected. */
  workspaceId: string | null;
  /** The group shown in the first selector; kept when a folder is picked, since a folder can belong to several workspaces. */
  browsedWorkspaceId: string | null;
  commandName: string | null;
  selectWorkspace(workspaceId: string | null): void;
  browseWorkspace(workspaceId: string | null): void;
  selectCommand(commandName: string | null): void;
}

export const useCommandSettingsScope = create<CommandSettingsScopeState>((set) => ({
  workspaceId: null,
  browsedWorkspaceId: null,
  commandName: null,
  selectWorkspace: (workspaceId) => set((state) => ({
    workspaceId,
    commandName: null,
    browsedWorkspaceId: workspaceId ?? state.browsedWorkspaceId,
  })),
  browseWorkspace: (browsedWorkspaceId) => set({ browsedWorkspaceId }),
  selectCommand: (commandName) => set({ commandName }),
}));
