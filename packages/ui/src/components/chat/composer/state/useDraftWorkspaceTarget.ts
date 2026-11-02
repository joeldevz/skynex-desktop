import React from 'react'

import { useWorkspacesStore } from '@/stores/useWorkspacesStore'
import { useSessionUIStore } from '@/sync/session-ui-store'
import { useRuntimeAPIs } from '@/hooks/useRuntimeAPIs'

export function useDraftWorkspaceTarget(enabled: boolean) {
  const { settings } = useRuntimeAPIs()
  const status = useWorkspacesStore((state) => state.status)
  const catalog = useWorkspacesStore((state) => state.catalog)
  const error = useWorkspacesStore((state) => state.error)
  const load = useWorkspacesStore((state) => state.load)
  const draft = useSessionUIStore((state) => state.newSessionDraft)
  const selectTarget = useSessionUIStore((state) => state.setNewSessionDraftWorkspaceTarget)

  React.useEffect(() => {
    if (!enabled || !settings || status !== 'unloaded') return
    void load()
  }, [enabled, load, settings, status])

  return {
    workspaces: status === 'ready' ? catalog.workspaces.filter((workspace) => workspace.folders.length > 0) : [],
    status,
    error,
    selectedWorkspaceId: draft.workspaceScope?.workspaceId ?? null,
    selectedFolderId: draft.workspaceScope?.folders.length === 1
      ? draft.workspaceScope.folders[0].id
      : null,
    selectTarget,
    retry: load,
  }
}
