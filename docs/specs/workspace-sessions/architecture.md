# Workspaces and explicit open sessions

## Contract and scope

`design-tree.md` D1 through D13 define the product contract. A workspace groups existing folders and their documentation. The sidebar places workspaces above a global, explicitly opened session list. Closing preserves conversation history. Folder unlinking preserves existing sessions and their selected-folder access.

This specification defines implementation boundaries and acceptance contracts. All new types, functions, components, settings and test files named here are proposed. Existing signatures are identified separately. Production traffic, user count and deployment SLAs are unspecified. Persistence and permission failures have high impact because they can lose the user's working set or misrepresent agent access.

Excluded work includes terminals, folder or repository creation, workspace deletion, automatic documentation edits, dependency changes, upstream OpenCode edits and unrelated Skynex Tasks repair. Existing history remains reachable. Existing worktree, isolated-space and archive tools keep their separate contracts.

## State and persistence

Use 3 owners with independent lifecycles.

| State | Owner and proposed files | Authority and lifetime |
|---|---|---|
| Workspace definitions | `packages/ui/src/lib/workspaces/model.ts`, `schema.ts`; `packages/ui/src/stores/useWorkspacesStore.ts` | Versioned `workspaceCatalog` instance setting. Contains stable workspace IDs, names, descriptions, ordered folder IDs with normalized absolute paths and role documentation, and optional model/agent defaults. Shared by clients of the same server settings authority. No cross-host profile sync. |
| Session workspace binding | `packages/ui/src/lib/workspaces/session-scope.ts` | `session.metadata.openchamber.workspaceScope`, written at creation through OpenCode. Contains version, workspace ID/name snapshot, primary directory, and ordered selected folder snapshots with IDs, paths and role documentation. History and reopened sessions retain this binding. |
| Explicit open membership and selected overview | `packages/ui/src/stores/useOpenSessionsStore.ts` | Device-local durable snapshot keyed by stable runtime identity. Contains version, migration marker and ordered session references with primary-directory and scope snapshots. Selected workspace/overview is device-local. Membership survives restart independently of global-list completeness and live activity. |

Keep `ProjectEntry.path` singular. The existing `useProjectsStore` remains the directory/project compatibility catalog for filesystem, Git and worktree consumers. Workspace membership does not call `removeProject`, which clears session-folder state and may stop spaces. A folder can belong to several workspaces. Use workspace/folder IDs for ownership and normalized paths for directory routing. Preserve Windows drive roots with `lib/pathNormalization.ts`.

The scope model requires a nonempty folder selection and a primary directory contained in that selection. Choose the first selected folder in workspace order as primary. The primary directory supplies OpenCode's single location and configuration context. Selection does not merge several OpenCode configurations or change directories on each request. An empty workspace remains editable but cannot create an agent session until a folder is selected.

### Exported domain contracts

These proposed exports are the test contract. Pure functions use real values; store tests instantiate a fresh vanilla Zustand store with small in-memory adapters and deferred promises. No module mocking, React mount or running OpenCode is needed for persistence and membership tests.

```ts
// lib/workspaces/model.ts, reusing ModelSelection from lib/opencode/model.ts.
export type WorkspaceFolder = Readonly<{
  id: string; path: string; role: string;
}>;
export type WorkspaceDefaults = Readonly<{
  model?: ModelSelection; agent?: string;
}>;
export type Workspace = Readonly<{
  id: string; name: string; description: string;
  folders: readonly WorkspaceFolder[]; defaults: WorkspaceDefaults;
}>;
export type WorkspaceCatalog = Readonly<{
  version: 1; workspaces: readonly Workspace[];
}>;
export type WorkspacePatch = Readonly<{
  name?: string; description?: string;
  folders?: readonly WorkspaceFolder[]; defaults?: WorkspaceDefaults;
}>;
export type ParseResult<T> =
  | { kind: 'missing' }
  | { kind: 'valid'; value: T }
  | { kind: 'invalid'; reason: string };

// lib/workspaces/schema.ts. null alone means successfully missing storage.
export function parseWorkspaceCatalog(json: string | null): ParseResult<WorkspaceCatalog>;
export function putWorkspace(catalog: WorkspaceCatalog, workspace: Workspace): WorkspaceCatalog;
export function patchWorkspace(catalog: WorkspaceCatalog, id: string, patch: WorkspacePatch): WorkspaceCatalog;
export function unlinkWorkspaceFolder(catalog: WorkspaceCatalog, workspaceId: string, folderId: string): WorkspaceCatalog;

// lib/workspaces/session-scope.ts.
export type FolderSelection =
  | { kind: 'workspace' }
  | { kind: 'folder'; folderId: string }
  | { kind: 'explicit'; folderIds: readonly string[] };
export type ScopeResult<T> =
  | { kind: 'valid'; value: T }
  | { kind: 'invalid'; reason: 'empty-selection' | 'unknown-folder' | 'duplicate-folder' };
export function selectWorkspaceFolders(workspace: Workspace, selection: FolderSelection): ScopeResult<readonly WorkspaceFolder[]>;
export type WorkspaceSessionScope = Readonly<{
  version: 1; workspaceId: string; workspaceName: string;
  description: string; primaryDirectory: string;
  folders: readonly WorkspaceFolder[];
}>;
export function snapshotWorkspaceScope(workspace: Workspace, selection: FolderSelection): ScopeResult<WorkspaceSessionScope>;
export function resolveWorkspaceDefaults(workspace: Workspace, overrides: WorkspaceDefaults): WorkspaceDefaults;

// stores/useOpenSessionsStore.ts. StoreApi comes from zustand/vanilla.
export type OpenSessionReference = Readonly<{
  sessionId: string; title: string; primaryDirectory: string;
  scope: WorkspaceSessionScope | null;
}>;
export type OpenSessionsSnapshot = Readonly<{
  version: 1; migrated: true; sessions: readonly OpenSessionReference[];
}>;
export type MembershipResult =
  | { kind: 'saved' }
  | { kind: 'retained'; reason: 'load-failed' | 'persistence-failed' | 'runtime-changed' | 'runtime-unavailable' };
export type HydrationResult =
  | { kind: 'ready' }
  | { kind: 'retained'; reason: 'read-failed' | 'invalid-snapshot' | 'persistence-failed' | 'runtime-changed' | 'runtime-unavailable' };
export type SessionCloseResult =
  | { kind: 'closed' }
  | { kind: 'confirmation-required' }
  | { kind: 'retained'; reason: 'load-failed' | 'activity-unknown' | 'stop-failed' | 'persistence-failed' | 'runtime-changed' | 'runtime-unavailable' };
export type OpenSessionsState = {
  runtimeKey: string | null;
  sessions: readonly OpenSessionReference[];
  hydration: 'unloaded' | 'loading' | 'ready' | 'failed';
  hydrate(viewedSession: OpenSessionReference | null): Promise<HydrationResult>;
  openSession(reference: OpenSessionReference): Promise<MembershipResult>;
  closeSession(sessionId: string, confirmation: 'unconfirmed' | 'stop-confirmed'): Promise<SessionCloseResult>;
};
export type OpenSessionsAdapters = {
  runtimeKey(): string | null;
  read(runtimeKey: string): Promise<string | null>;
  write(runtimeKey: string, json: string): Promise<void>;
  activity(runtimeKey: string, reference: OpenSessionReference): 'active' | 'idle' | 'unknown';
  interrupt(runtimeKey: string, reference: OpenSessionReference): Promise<boolean>;
};
export function parseOpenSessionsSnapshot(json: string | null): ParseResult<OpenSessionsSnapshot>;
export function createOpenSessionsStore(adapters: OpenSessionsAdapters): StoreApi<OpenSessionsState>;
```

Parsers validate the whole document, reject unsupported versions, duplicate identities, malformed paths and mismatched scope/primary-directory references, and return normalized copies. Arrays preserve workspace order; selection results use workspace folder order regardless of explicit input order. Empty explicit selection fails. Snapshot functions deep-copy selected folders so later input mutation cannot change existing sessions. Defaults resolve each supplied override ahead of its workspace default, without inventing runtime defaults. `putWorkspace` inserts or replaces one complete workspace; patch and unlink require existing IDs and throw `Error` on invalid input without modifying their inputs. Unlinking an already absent folder is an identity-preserving no-op. There is no workspace-delete export.

Store methods capture runtime identity at invocation. `hydrate` is also the namespace activation operation after a runtime switch; it clears the displayed previous-runtime references synchronously, then loads only its captured owner. Within the same runtime it preserves existing references during loading/failure. `viewedSession` is captured once for a missing-snapshot migration, and subsequent calls cannot replace that seed while the first load is pending. Opens and closes issued during hydration are ordered mutations over the loaded baseline; they wait for a valid baseline before saving. A failed/invalid baseline resolves waiting mutations as retained with `load-failed`, preserves their intents for an explicit hydrate retry and cannot trigger an empty overwrite. `openSession` is idempotent by session ID and updates that reference in place without reordering other rows. Closing an absent ID records a hydration tombstone and otherwise succeeds without interrupting or writing an unchanged snapshot. Cancellation is represented by making no second close call after confirmation-required.

Serialize writes per captured runtime, including operations invoked before hydration completes. Persist before publishing successful membership mutations. Reject stale UI publication after runtime switches while allowing already-started writes to finish against their captured namespace. Same-runtime hydrate results reconcile acknowledged newer mutations, including absent-ID close tombstones. The factory never reads global session history, starts locations or creates conversations. Tests can therefore prove C3-C9 and the state portion of C12 with real factory methods, retained input snapshots, adapter call arguments and controlled promise ordering.

### Production bindings without duplicate authorities

`useWorkspacesStore.ts` holds the acknowledged settings-backed catalog and pending UI edits only. Its create/update/unlink actions call the pure catalog functions, serialize saves through the existing settings owner, then adopt the acknowledged parsed result. Creation supplies a new stable ID at the action boundary. `registry.ts` delegates its value validation to the same workspace schema; the registry parser maps invalid values to its existing rejection contract. Settings/bootstrap uses the same store apply action. Do not add a second catalog file or an independent auto-save subscriber for this key.

Create exactly one production `createOpenSessionsStore` instance and use Zustand's `useStore(instance, selector)` for React subscriptions. Its `read`/`write` adapters serialize only `OpenSessionsSnapshot` through runtime-namespaced safe storage; read failures reject and write failures must reject rather than be swallowed by a convenience wrapper. `runtimeKey` delegates to the established stable runtime resolver, returning null during transient/unresolved identity. `activity` delegates to `getSessionLiveActivity`; `interrupt` verifies the captured runtime and calls `opencodeClient.abortSession(reference.sessionId, reference.primaryDirectory)`. Tests use the same factory with an in-memory map and plain adapter functions, not a parallel test implementation.

`runtimeEndpointReset.ts` invokes this instance's `hydrate` with the restored viewed reference. Selection/history code requests open/close transitions from this instance; header tabs and sidebar read it. Existing session metadata remains the scope authority, while the persisted reference is its startup label/routing copy. Hydration never infers removal from missing global records. Keep navigation outside the factory and perform it only after `closed`. No second Zustand persistence middleware, tab membership collection, global-history reducer or settings mirror may also own explicit-open membership.

### Storage ordering and migration

1. Register `workspaceCatalog` with `scope: 'instance'` in `packages/ui/src/lib/settings/registry.ts`. Parse it in `parsers.ts`. Extend server `packages/web/server/lib/opencode/settings-helpers.js` validation. Generate both `packages/web/server/lib/opencode/settings-registry.json` and `packages/vscode/src/settings-registry.json` from the registry. Use the existing `SettingsAPI.load()` and `save(changes: Partial<SettingsPayload>): Promise<SettingsPayload>` transport. No new HTTP route is required.
2. Serialize catalog writes per captured settings authority. Commit acknowledged data and preserve the prior catalog on failure. Same-client late loads cannot overwrite newer edits. Cross-client catalog saves follow the existing settings last-accepted-write behavior; this change introduces no collaborative merge protocol.
3. Distinguish a successfully missing catalog from valid empty, malformed and failed loads. Only a successfully missing catalog seeds one singleton workspace per existing project, preserving its label and defaults and deriving stable workspace IDs from project IDs. Persist the versioned result before treating migration as complete. Never seed after a failed read or overwrite an explicitly empty catalog.
4. Store open membership through the existing safe-storage boundary in `packages/ui/src/stores/utils/safeStorage.ts`. Use `getRuntimeKey()` from `lib/runtime-switch.ts`, including stable mobile device identity across LAN/relay changes. Do not create a shared empty/transient namespace. Membership is intentionally independent per device and runtime; it does not sync between browser installs.
5. Capture the current viewed session at the first valid runtime restore boundary. If the open-membership snapshot is successfully absent, seed only that captured session, or an empty list when none is viewed. Ignore legacy preview tabs, pinned tabs, In work state and historical lists. Write the migration marker in the same snapshot. A valid empty snapshot means every session is closed. Read failure or malformed data requires recovery and preserves existing memory; neither reruns first migration.
6. Serialize membership writes. Capture runtime and mutation revision before hydration and overlay later local opens/closes before commit. Record close mutations even when a reference is absent. Late completions from another runtime cannot mutate current state. Persist operations before acknowledging them; failed writes keep prior membership and expose retry. Do not depend on a debounce at application shutdown for durability.
7. A global-list miss, partial page, directory failure or reconnect never removes membership. Keep unresolved rows with their saved labels and retry state. Resolve session records by ID through the global index and targeted session lookup. Never start every selected folder's OpenCode location just to populate the sidebar.

Session creation writes the immutable folder binding in the create request. Add open membership only after successful creation. If membership persistence fails after creation, preserve the created conversation and offer retry for that exact ID. Never retry by creating another conversation. Explicit reopen uses the saved binding. A legacy session with no binding uses its authoritative existing directory and a singleton scope; it does not inherit every folder of whichever workspace happens to be selected.

## Multi-folder execution and permission policy

Existing `packages/ui/src/lib/opencode/client.ts` exposes:

- `createSession(params?: { id?: string; title?: string; agent?: string; model?: ModelSelection; metadata?: Metadata }, directory?: string | null): Promise<Session>`.
- `sendMessage(params)` with `context?: SyntheticContextInput[]`, `directory?: string | null` and `runtimeKey?: string`.
- `abortSession(id: string, directory?: string | null): Promise<boolean>`.

The pinned client and bundled CLI are 2.1.4. The existing minimum compatibility version is 2.1.0. `SessionCreateInput` has one `location.directory`, metadata and optional permission rules. `SessionSyntheticInput` accepts text and metadata. `sendMessage` admits synthetic context with `resume: false` before `session.prompt`. These support an explicit folder manifest delivered to the model. They do not establish several working directories or filesystem confinement.

Build a deterministic context item in `lib/workspaces/session-scope.ts`. Include the primary directory, every selected absolute path, workspace description, and each folder's role. Label documentation as user-authored reference material. Explain that tools must address non-primary folders by absolute path and that normal access permission requests still apply. Use current explicitly edited documentation for still-linked folder IDs; retain the binding's documentation/path snapshots after unlink. Do not write project documentation files or inject a new global configuration.

Attach this manifest at the shared send boundary in `packages/ui/src/sync/session-ui-store.ts`, before both normal prompt and slash-command branches. The existing path is `sendMessage` to `optimisticSend` to `opencodeClient.sendMessage` to `session.synthetic` to `session.prompt`. Command sends also accept context. Capture scope with queued sends so later workspace edits cannot replace their selected folders. Include the manifest on each agent turn to survive restart and context compaction. Existing non-workspace sends retain their behavior. Shell input remains outside this feature.

Folder selection never sets bypass/auto-accept, never sends `external_directory: allow`, and never replaces session permissions. Existing permission requests remain visible through `components/chat/permissionSummary.ts`, including `external_directory`. Selecting a folder supplies context; the runtime and the user still authorize access. A denied or unavailable folder produces an explicit unavailable state, with the selection preserved for diagnosis.

### Shipped tool compatibility evidence

Static inspection of the installed OpenCode 2.1.4 executable establishes absolute-path read/edit/write and external shell working-directory support. The executable SHA-256 is `ca9b3ee262e33bb4e7aa0e1230dc61086a474c8c8016b980081d0719712fd2e7`. Embedded FileAccess code at byte offsets 167589587 through 167591250 resolves supplied absolute paths and checks external-directory permission. Read, edit and write implementations at offsets 167705810, 167686400 and 167823850 perform their respective permission checks before filesystem operations. Permission evaluation at 167140500 through 167145850 honors effective denial before saved grants. Shell preparation authorizes its working directory before spawning. These findings resolve A1 for ordinary host sessions without adding grants or modifying upstream code.

The session still has one primary configuration context. External targets do not discover separate local instruction files. Static compatibility evidence plus C10 wire tests must establish that selected paths reach those tools' model context and remain after restart/unlink. Live provider-driven integration and host OS access rights were not exercised and must be disclosed separately; state tests alone do not establish wire integration. Unsupported isolated-space and VS Code targets retain the explicit limits below.

## Runtime compatibility

| Runtime | Workspace and session behavior | Folder access boundary |
|---|---|---|
| Web | Shared workspace UI, server-instance catalog, device-local open list | Paths and picker address the connected server filesystem. Existing runtime file/permission APIs validate selection. No assumption that browser-local folders are server folders. |
| Electron | Same shared state and server settings contract | Reuse web/runtime behavior and existing native directory access. Retain any acquired native access needed by an open scope until its final consumer closes; workspace unlink alone releases nothing required by that session. No new main/preload domain service. |
| VS Code | Same workspace-above/open-sessions-below model and explicit membership, via extension settings bridge | Existing VS Code project discovery constrains roots to opened editor workspace folders. Initial support selects among those existing roots. Outside-root additions return an explicit unsupported reason; do not silently omit a selection. Saved open sessions keep their scope references when editor roots change, and show unavailable access if the host withdraws it. Arbitrary outside-root access needs a separately evidenced host capability. |
| Hosted mobile | Same contract and responsive controls using the connected server's settings | All folders belong to the remote server. No phone filesystem picker or host path translation. |
| Capacitor mobile | Same remote catalog and per-device/per-server membership | Use existing runtime file/permission APIs. Transport switching for the same paired server preserves membership; switching servers separates it. |
| Isolated space target | Existing space sessions/history remain usable through their current contract | Arbitrary host-folder scopes are unsupported. Disable the multi-host-folder creation target with a reason. Spaces own copied code and mount no host folders. No automatic copy, mount or new grant flow is authorized. |

The VS Code root constraint and isolated-space unsupported state must be visible before creation. They are compatibility limits, not permission to discard selected folders. A full promise of arbitrary folders in those environments would require additional capability decisions. The ordinary host multi-folder gate above remains separate.

## Implementation slices

### 1. Persist workspace definitions and immutable session scope

**What and why.** Add workspace identity without repurposing path-scoped projects or losing unlinked-folder references.

**Where.** New `lib/workspaces/model.ts`, `schema.ts`, `session-scope.ts` and `stores/useWorkspacesStore.ts` under `packages/ui/src`; existing `lib/api/types.ts`, `lib/settings/registry.ts`, `parsers.ts`, `lib/persistence.ts`; web `server/lib/opencode/settings-helpers.js` and both registry snapshots. Existing web `src/api/settings.ts` and VS Code `webview/api/settings.ts` remain transport owners. VS Code `src/bridge-config-runtime.ts` owns settings bridge dispatch, with `src/settings-files.ts` owning file format.

**How.** Implement the schemas and persistence/migration rules above. Keep feature parsing at its boundary; malformed workspace payloads must reject before they gain authority. Add runtime capability decisions to domain selection validation using `RuntimeAPIs` through `useRuntimeAPIs` or registered APIs outside React. Tighten the feature's handling of VS Code malformed settings responses, whose existing sanitizer can return `{}`; absence must never hide transport/parse failure. Do not introduce filesystem access in stores. Reuse normalized existing-folder selection, bypassing clone/create actions in `components/session/DirectoryExplorerDialog.tsx`.

**Acceptance.** C1, C2 and C6 below cover round trips, defaults, migration and retained scope. No workspace unlink calls project cleanup, filesystem deletion, session archive or permission-mode setters.

### 2. Own explicit open membership and close transactions

**What and why.** Make membership independent of history, busy status and header-preview policy.

**Where.** New `packages/ui/src/stores/useOpenSessionsStore.ts`; existing `sync/session-actions.ts`, `sync/session-ui-store.ts`, `apps/runtimeEndpointReset.ts`, `stores/useSessionTabsStore.ts`, `lib/sessionTabs.ts`, `components/layout/SessionTabsStrip.tsx`, `hooks/useKeyboardShortcuts.ts`.

**How.** Implement open/close on the new owner. Bind successful user creation and explicit history reopen to `openSession`. Ordinary record hydration and incoming session events do not open sessions. Capture migration before an overview/default draft selection can replace the restored viewed session. Runtime reset changes the active namespace and cancels obsolete UI results; pending persistence writes remain bound to their captured owner.

Use existing `getSessionLiveActivity(sessionId): SessionLiveActivity` for authoritative `active | idle | unknown`. Active close returns confirmation-required before any interrupt. Cancellation performs neither interrupt nor membership removal. Confirmed close calls `opencodeClient.abortSession` with the session's captured primary directory and checks the result. An acknowledged interruption permits closing; a false result requires authoritative idle confirmation. Error or unknown state retains membership with recovery. Refresh unknown activity only for that session; unknown never follows the idle fast path. Recheck activity immediately before the close mutation. Retain membership if a newly observed run or unresolved stop makes closure unsafe. Do not use `abortCurrentOperation`, which logs and swallows failures.

Persist removal before navigating to a remaining open neighbour or workspace overview. Closing the last session must not manufacture a new conversation or automatically reopen history. History records and folder bindings survive. If interruption succeeds but persistence fails, keep the session visibly open and report that it stopped but could not close.

Keep the header strip as a projection of the explicit owner when displayed. Remove preview replacement, the 10-pinned-tab eviction and mount-driven opening as authorities. Route header/shortcut close through the same transaction. `leaveFinishedSessions` and callers in `components/chat/SessionDoneHintRow.tsx`, `components/session/SessionDialogs.tsx`, `components/session/sidebar/works/workActions.ts`, `components/session/sidebar/sessions/useRunWork.ts` and `SessionNodeItem.tsx` must not close membership on completion, Mark done or folder unlink. Avoid maintaining 2 writable working sets.

**Acceptance.** C3 through C5 and C7 through C9. More than 10 open sessions persist; completion and mounting the tab strip cannot alter the list.

### 3. Wire creation, context and runtime folder access

**What and why.** Make selected scope observable in actual sends while preserving ordinary authorization.

**Where.** Existing `packages/ui/src/sync/session-actions.ts`, `sync/session-ui-store.ts`, `lib/opencode/client.ts`, `stores/useSessionDraftsStore.ts`; new `lib/workspaces/session-scope.ts` and `lib/workspaces/runtime-policy.ts`. Existing `lib/api/types.ts`, web `src/api/files.ts`, `src/api/permissions.ts`, VS Code `webview/api/files.ts` and `webview/api/permissions.ts` remain runtime boundaries. Extend an adapter only when the existing contract cannot express a supported result; no new native or space capability is implied.

**How.** Add an explicit scope field to draft creation and capture its defaults once. Workspace creation starts with all current folders; folder creation starts with exactly that folder. The picker may change either before submission. Resolve explicit model/agent overrides before workspace defaults, then fall back to existing runtime defaults when absent. Validate model/agent against the primary location's existing catalogs without reading every selected folder's catalogs. Capture model, agent, scope and runtime with queued work.

Pass scope through the existing exported `createSession(title?, directoryOverride?, metadata?, selectionTransition?, selection?, navigation?)` call chain, preserving existing callers. Merge the namespaced binding into metadata without replacing unrelated fields. Use the primary directory as `directoryOverride`; return the created record's actual routing directory. Add the manifest through existing synthetic context handling on prompts and commands. Do not claim that a session metadata field alone changes tool access. Preserve selected-folder path snapshots when the workspace changes. Gate a multi-folder success claim on the A1 evidence described above.

**Acceptance.** C2, C6 and C10 through C12. Wire tests prove exact paths/context and unchanged permission arguments. Shipped-tool compatibility is established separately above; live provider-driven integration remains an explicitly untested surface.

### 4. Compose the workspace overview and global list

**What and why.** Expose the agreed organization on every supported UI without deriving open membership from project filters.

**Where.** Existing `packages/ui/src/components/session/SessionSidebar.tsx`, `sidebar/list/SessionProjectCollection.tsx`, `components/layout/MainLayout.tsx`; new `components/session/workspaces/WorkspaceList.tsx`, `WorkspaceOverview.tsx`, `WorkspaceSessionScopePicker.tsx` and `components/session/sidebar/list/OpenSessionCollection.tsx`. Mobile integration owners are `apps/MobileSessionsSheet.tsx`, `apps/MobileSessionSwitcher.tsx`, `apps/mobileSidebar/MobileSessionList.tsx` and `MobileSessionRow.tsx`.

**How.** Render workspace selection above explicit open rows. Selecting a workspace activates an overview destination without closing or filtering open rows. The overview edits name, description, folder roles/membership and defaults through the workspace owner. It offers workspace/folder session creation and links to that workspace's open sessions. Existing history is a separate destination, with explicit reopen actions. Rows resolve labels from binding/workspace IDs and show folder scope including retained unlinked folders. Session selection routes by its saved primary directory; singular-path project auto-selection must not overwrite workspace identity.

Use existing themed controls and responsive patterns. Load UI guidance, theme, RTL, locale and settings skills before implementing their corresponding controls. Add keys to `packages/ui/src/lib/i18n/messages/en.ts` and required locale catalogs under that directory using the locale skill's fallback rules. No new ordering gestures or shortcut assignments are specified. Do not let old timeline/project filters reinsert historical sessions into the global open list.

Subscribe structural lists to membership/catalog changes and row activity to leaf live-state selectors. Token events do not scan all history, sort all workspaces or persist membership. No per-folder initialization fan-out. An operation-count guard with 1,000 history records and 20 explicit open sessions asserts that a token-only update performs zero membership writes and zero structural list rebuilds. These are fixture counts, not measured production scale or latency claims.

Update owning `packages/ui/src/components/session/sidebar/DOCUMENTATION.md`, `packages/ui/src/sync/DOCUMENTATION.md`, `packages/ui/src/stores/DOCUMENTATION.md`, `packages/ui/src/lib/settings/DOCUMENTATION.md` and new `packages/ui/src/lib/workspaces/DOCUMENTATION.md` when those contracts land. Document the explicit owner, folder-snapshot retention, single-location semantics and runtime limits. Update VS Code `src/DOCUMENTATION.md` if bridge behavior changes.

**Acceptance.** C1, C3, C6, C11 and C12. Mobile, VS Code and header tabs expose the same membership and close outcome.

## Frozen requirement-to-test matrix

Each row defines a behavioral contract for the later HIGH/TDD implementation. New test files are proposed. Existing test files are regression anchors. Test ownership and progress remain outside this specification. Test authors establish expected RED failures before source implementation; implementations consume the accepted contract unchanged.

| ID / decisions | Given / when / then | Primary test owner |
|---|---|---|
| C1 / D1-D5 | Given 2 named workspaces with unrelated existing folders including a non-Git directory, when selecting and editing one overview, then only explicit edits persist, roles/defaults round-trip, the global open list remains visible, and no file/repo/workspace deletion is offered. | New `lib/workspaces/schema.test.ts`, `components/session/workspaces/WorkspaceOverview.test.tsx`, `stores/useWorkspacesStore.test.ts`; existing `lib/settings/registry.test.ts`, web `settings-helpers.test.js` |
| C2 / D5-D7 | Given workspace A/B folders and defaults, when creating from workspace or folder B, then initial selection is A+B or B respectively, user changes and model/agent overrides reach create and queued send unchanged, and empty selection is rejected. | Existing `sync/session-actions.test.ts`, `sync/session-ui-store.test.js`; new `lib/workspaces/session-scope.test.ts` |
| C3 / D2,D8,D9 | Given sessions across directories and unloaded history, when creating/reopening 12 sessions, switching workspaces or completing turns, then all 12 remain open once, history-only sessions stay absent and no preview/cap eviction occurs. | New `stores/useOpenSessionsStore.test.ts`; existing `stores/useSessionTabsStore.test.ts`; new `components/session/sidebar/list/OpenSessionCollection.test.tsx` |
| C4 / D9,D12 | Given missing membership on first restore, when the restored viewed session races with bootstrap/default navigation, then only that captured session is migrated once. On subsequent restart an explicit empty or populated list restores exactly, including unresolved records. | New `stores/useOpenSessionsStore.test.ts`; existing `apps/runtimeEndpointReset.test.ts`, `sync/session-ui-store.test.js` |
| C5 / D9,D12 | Given malformed/failed loads or delayed hydration, when a local open/close or runtime switch happens, then previous/newer membership survives, no migration runs on failure, and same IDs in another runtime cannot collide. Out-of-order writes cannot resurrect a closed row. | New `stores/useOpenSessionsStore.test.ts`, `stores/useWorkspacesStore.test.ts`; existing `apps/runtimeEndpointReset.test.ts` |
| C6 / D4,D6,D13 | Given an open session scoped to A+B, when B is unlinked and documentation explicitly edited, then existing session snapshots retain B and its access lifetime, future workspace creation excludes B, current linked documentation reflects explicit edits, and no project/session cleanup or filesystem mutation runs. | New `lib/workspaces/session-scope.test.ts`, `stores/useWorkspacesStore.test.ts`; existing `sync/session-actions.test.ts` |
| C7 / D10 | Given an idle open session, when explicitly closed through sidebar/header/shortcut, then membership is durably removed, history and binding remain, and explicit reopen restores the same session and scope. Last-close navigation creates no session. | New `stores/useOpenSessionsStore.test.ts`; new `lib/sessionTabs.test.ts`; existing `sync/session-actions.test.ts` |
| C8 / D11 | Given active or unknown activity, when close is requested or cancelled, then no unconfirmed interrupt/removal occurs. Confirmed successful interrupt removes membership using the session directory; rejection, false-without-idle-proof or a newly observed run retains it. | New `stores/useOpenSessionsStore.test.ts`; existing `sync/session-actions.test.ts`, `lib/opencode/client.test.ts` |
| C9 / D8-D11 | Given create/reopen/close persistence failure, when retrying, then prior membership stays recoverable, created history is retained without duplicate creation, stop success plus save failure reports stopped-but-open, and no stale completion changes another runtime. | New `stores/useOpenSessionsStore.test.ts`; existing `sync/session-actions.test.ts` |
| C10 / D6,D7,D13,A1 | Given scope A+B with ordinary permissions, when prompt/command/queued send occurs before and after restart/unlink, then exact absolute scope paths reach synthetic context before the agent turn and permission policy is unchanged. Shipped-tool evidence separately establishes absolute-path access and denial enforcement. | New `lib/workspaces/session-scope.test.ts`; existing `lib/opencode/client.test.ts`, `sync/session-ui-store.test.js`; shipped-tool static evidence |
| C11 / D1,D6,A1 | Given each runtime's filesystem scope, when selecting unavailable/outside-root/host folders in unsupported targets, then a stable explicit reason appears before creation, paths are never silently dropped and no cross-host grants are invented. Same-server mobile transport changes preserve membership. | New `lib/workspaces/runtime-policy.test.ts`; new `components/session/workspaces/WorkspaceSessionScopePicker.test.tsx`; existing VS Code `webview/api/settings.test.ts`, UI `apps/runtimeEndpointReset.test.ts` |
| C12 / D2,D8,D9 | Given partial global/directory results and token events, when records fail to load or stream, then saved open rows remain, other directories continue, no catalog/location fan-out starts, and token-only updates perform zero structural rebuilds/membership writes at the stated fixture size. | New `components/session/sidebar/list/OpenSessionCollection.test.tsx`; new `stores/useOpenSessionsStore.test.ts` |

## Verification commands and evidence boundaries

Commands are for later authorized owners. This specification does not authorize running tests, generating snapshots, builds, installs, network calls or a live app rebuild. No RED, GREEN, runtime-access or performance proof is claimed here.

Run TypeScript suites one file per process, for example from the repository root after the proposed files exist:

```sh
bun test ./packages/ui/src/stores/useWorkspacesStore.test.ts
bun test ./packages/ui/src/stores/useOpenSessionsStore.test.ts
bun test ./packages/ui/src/lib/workspaces/schema.test.ts
bun test ./packages/ui/src/lib/workspaces/session-scope.test.ts
bun test ./packages/ui/src/lib/workspaces/runtime-policy.test.ts
bun test ./packages/ui/src/sync/session-actions.test.ts
bun test ./packages/ui/src/lib/opencode/client.test.ts
bun test ./packages/ui/src/components/session/workspaces/WorkspaceOverview.test.tsx
bun test ./packages/ui/src/components/session/workspaces/WorkspaceSessionScopePicker.test.tsx
bun test ./packages/ui/src/components/session/sidebar/list/OpenSessionCollection.test.tsx
bun test ./packages/ui/src/stores/useSessionTabsStore.test.ts
bun test ./packages/ui/src/lib/sessionTabs.test.ts
bun test ./packages/ui/src/apps/runtimeEndpointReset.test.ts
bun test ./packages/ui/src/lib/settings/registry.test.ts
bun test ./packages/ui/src/sync/session-ui-store.test.js
bun test ./packages/vscode/webview/api/settings.test.ts
bun run --cwd packages/web test server/lib/opencode/settings-helpers.test.js
```

Use the repository's isolated runner when running directory-level UI or VS Code suites. The UI `test` script is `node ../../scripts/run-isolated-tests.mjs src`; the VS Code script covers `src webview`. Web uses `vitest run`. The isolated runner accepts directories, not single file arguments. Add focused serialization/bridge tests only if those owners change.

The coordinator runs root `bun run type-check` and `bun run lint` once on the combined candidate. `bun run check:changed` is the later pre-commit gate only when a commit is authorized. Registry generation uses `bun run settings-registry:generate` during authorized implementation. No build command belongs to this planning slice. Runtime/manual checks and UI performance profiles need separate authorization and must avoid overwriting installed `dist`.

## Risks and rollback

| Risk | Severity | Required control |
|---|---|---|
| Folder manifest mistaken for proven tool access | High | Keep the A1 evidence gate explicit; preserve normal permissions and verify the second unrelated directory. |
| Failed bootstrap or late restore erases the working set | High | Missing/failure/empty distinctions, mutation revisions, serialized writes and retained unresolved rows. |
| Close reports success while work continues | High | Confirmation, session-directory interrupt, result/idle checks and failed-stop retention. |
| Folder unlink withdraws access from existing sessions | High | Immutable scope snapshots and runtime access consumer lifetime independent of workspace membership. |
| Parallel clients overwrite workspace edits | Medium | Existing settings last-accepted-write semantics, refresh acknowledged state and expose save failures; no collaborative merge promise. |
| Sidebar reads initialize every folder and MCP fleet | Medium | Global session index, targeted lookup and no per-folder catalog/bootstrap loop. |

Failed migration leaves its source and prior valid snapshot intact and does not set completion markers. Failed writes preserve the last acknowledged state. Reverting application changes leaves new namespaced settings, membership snapshots and session metadata intact for recovery; old project data remains untouched. Older application versions do not understand explicit membership, so downgrade continuity of the new open list is not guaranteed. Rollback does not delete workspace metadata, history, folders or grants.
