# Workspace domain

## Ownership

This module owns the versioned workspace catalog schema, immutable selected-folder session bindings, folder selection, synthetic folder manifests, and runtime selection limits. The settings-backed catalog lives in `useWorkspacesStore`. Device-local explicit membership lives in the single `openSessionsStore` instance.

## Invariants

- A catalog can be missing, valid empty, or invalid. Only missing data permits project-to-workspace migration.
- Workspace IDs and folder IDs are stable. Folder paths are normalized absolute paths. `ProjectEntry.path` remains singular.
- A session binding has at least one selected folder and a selected primary directory. Selection follows workspace order and deep-copies its folders.
- Unlinking changes future workspace selections. Existing bindings retain their selected paths and unlinked documentation snapshots.
- Catalog deletion removes only the exact workspace ID and permits a valid empty catalog. Files, folders, conversations, explicit open membership, and captured session bindings remain unchanged.
- Every normal prompt or command includes a folder manifest. Queues capture that manifest when enqueued. Shell input keeps its existing behavior.
- The primary directory supplies the sole OpenCode configuration context. Folder selection changes no permission policy or filesystem grants.
- `metadata.openchamber.workspaceAssignment` stores only version 1, workspace ID and workspace name for an explicitly selected legacy root. Its schema and binding helper live in `session-assignment.ts`. Binding validates the saved folder match, preserves metadata siblings and refuses competing assignments or captured scopes. A same-workspace association is reusable.
- Assignment is organizational metadata. It never supplies a folder manifest, configuration context, access policy or directory override. Captured `workspaceScope` remains immutable and takes precedence.
- VS Code selections are limited to existing editor roots. Workspace host-folder scopes targeting isolated spaces are unsupported. Filesystem checks use registered runtime APIs and perform no OpenCode location reads.
- `formatWorkspaceLabel` is for presentation only. Workspace and folder display labels use one initial uppercase character with the remainder lowercase; catalog values, paths, search inputs, and session data remain unchanged.

## Decisions

### Why legacy history has a separate assignment

Opening an earlier conversation links its existing directory to a workspace label. Capturing the workspace's folders at that point would change the conversation's context. Separate metadata retains the association after local close and reference reconstruction without adding folders or grants.

### Why a session snapshot and a separate catalog

Sessions need their selected folders after a workspace edit or unlink. The manifest reads current documentation only for still-linked matching folder IDs and paths; all other documentation comes from the binding.

### Why synthetic context with ordinary permissions

OpenCode has one location per session. The manifest names absolute external paths without merging configuration roots or granting tool access. Live provider-driven multi-folder execution remains unverified by this state slice.
