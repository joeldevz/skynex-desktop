import React from 'react'

import { useWorkspacesStore } from '@/stores/useWorkspacesStore'
import { useSessionUIStore } from '@/sync/session-ui-store'
import { useRuntimeAPIs } from '@/hooks/useRuntimeAPIs'
import { getRuntimeKey } from '@/lib/runtime-switch'
import { prepareGeneralWorkspaceDraftForRuntime } from '@/lib/workspaces/general-chat-preparation'
import type { FolderSelection } from '@/lib/workspaces/session-scope'
import { generateUuid } from '@/lib/uuid'

export function useDraftWorkspaceTarget(enabled: boolean) {
  const { settings } = useRuntimeAPIs()
  const status = useWorkspacesStore((state) => state.status)
  const catalog = useWorkspacesStore((state) => state.catalog)
  const error = useWorkspacesStore((state) => state.error)
  const load = useWorkspacesStore((state) => state.load)
  const draft = useSessionUIStore((state) => state.newSessionDraft)
  const selectTarget = useSessionUIStore((state) => state.setNewSessionDraftWorkspaceTarget)
  const beginPreparation = useSessionUIStore((state) => state.beginGeneralWorkspaceTargetPreparation)
  const failPreparation = useSessionUIStore((state) => state.failGeneralWorkspaceTargetPreparation)
  const commitPreparation = useSessionUIStore((state) => state.commitGeneralWorkspaceTargetPreparation)

  React.useEffect(() => {
    if (!enabled || !settings || status !== 'unloaded') return
    void load()
  }, [enabled, load, settings, status])

  const select = React.useCallback((workspaceId: string | null, selection: FolderSelection = { kind: 'workspace' }) => {
    if (workspaceId === null || selection.kind !== 'workspace') {
      selectTarget(workspaceId, selection)
      return
    }
    const current = useSessionUIStore.getState().newSessionDraft
    const workspaceState = useWorkspacesStore.getState()
    const workspace = workspaceState.catalog.workspaces.find((entry) => entry.id === workspaceId)
    const runtimeKey = getRuntimeKey()
    if (!current.open || current.pendingWorktreeRequestId || current.bootstrapPendingDirectory
      || workspaceState.status !== 'ready' || workspaceState.runtimeKey !== runtimeKey || !workspace) return
    const preparationId = generateUuid()
    if (!beginPreparation(current.draftId, preparationId, workspaceId)) return
    void prepareGeneralWorkspaceDraftForRuntime(workspace).then((result) => {
      if (result.kind !== 'ready') {
        failPreparation(current.draftId, preparationId, runtimeKey, result.reason)
        return
      }
      const committed = commitPreparation(
        current.draftId,
        preparationId,
        runtimeKey,
        result.scope,
        result.defaults,
        result.unavailableSavedAgent,
      )
      if (!committed) failPreparation(current.draftId, preparationId, runtimeKey)
    }).catch(() => failPreparation(current.draftId, preparationId, runtimeKey, 'runtime-unavailable'))
  }, [beginPreparation, commitPreparation, failPreparation, selectTarget])

  return {
    workspaces: status === 'ready' ? catalog.workspaces.filter((workspace) => workspace.folders.length > 0) : [],
    status,
    error,
    selectedWorkspaceId: draft.workspaceTargetAttemptWorkspaceId ?? draft.workspaceScope?.workspaceId ?? null,
    selectedFolderId: draft.workspaceScope?.version === 1 && draft.workspaceScope.folders.length === 1
      ? draft.workspaceScope.folders[0].id
      : null,
    selectTarget: select,
    preparationPending: draft.workspaceTargetPending === true,
    preparationFailed: draft.workspaceTargetError === true,
    preparationFailureReason: draft.workspaceTargetErrorReason ?? null,
    retry: load,
  }
}
