# Workspace overview

## Ownership

The overview edits one workspace through callback props. The parent owns folder picking, persistence, session creation and navigation. Model and agent options come from the parent. This component makes no runtime requests.

`WorkspaceNavigation` binds catalog selection, explicit membership and history access. `WorkspaceSurface` connects the editor to acknowledged catalog writes and `openWorkspaceDraft`. The directory dialog's selection-only branch validates existing paths through the runtime files API and performs no project creation, cloning or filesystem creation. VS Code offers existing editor roots only. Catalog reads address only the overview's primary folder; creation validates defaults against its selected primary folder.

`WorkspaceNavigation` owns the view shell and its pinned footer slot. The parent supplies the sidebar footer and its controller once, outside both the overview and history scrollers; history remains responsible for its own list scrolling.

The Scheduled tasks action sits in the navigation row above the workspace list. It opens the shared scheduled-task view from both workspace navigation and session history, and exposes its open state through the selected-button styling.

The scheduled-task view uses workspace and folder rows as virtual scopes over
the Chat task store. Selecting a workspace includes its folders; selecting a
folder narrows the target. The task's storage owner remains Chat for these
scopes, while legacy project-owned tasks remain in their separate compatibility
group.

## Invariants

- The editor has Home, Folders, Sessions and Scheduled tasks tabs. Only the active editor panel occupies space. Panels stay mounted so tab changes retain unsaved fields and the session folder filter. Switching editor tabs performs no writes. Selecting Scheduled tasks opens the shared scheduler with the current workspace preselected; the mobile app routes through its app-surface action so the inline workspace dialog cannot cover the scheduler. Closing the scheduler returns the editor to Home. Errors and deletion confirmation remain outside the panels.
- Name, description, roles and defaults remain in a draft until Save. Folder unlinking writes immediately through the acknowledged catalog operation; a retained write keeps the folder visible and exposes an error. An acknowledged unlink removes only that folder and preserves unrelated unsaved draft fields.
- The workspace header action opens a new composer draft with all saved folders selected. A folder-row action opens a new draft with only that saved folder selected. The parent validates scope and defaults before opening the draft.
- Creation uses saved workspace defaults. Saving the draft updates the defaults used by later sessions when the parent supplies the acknowledged workspace.
- Parent workspace updates replace the local draft. Existing session snapshots remain the parent's responsibility.
- Workspace deletion requires a modal confirmation naming the saved workspace and explaining that only its grouping and configuration are removed. Cancel and dismissal perform no mutation. Pending actions are disabled, and a failed deletion keeps the confirmation and error visible.
- The overview has no filesystem creation or terminal actions. Its optional deletion callback supports independent rendering; the production surface always wires it to acknowledged catalog removal.
- Before opening a composer draft, selected paths pass the existing runtime scope policy. Unsupported isolated-space targets and unavailable folders retain the editor and show a localized error. Folder selection grants no permission.
- Workspace overview selection is restored from device/runtime-local storage. Explicit session or draft navigation clears that selection without changing open membership.
- One Sessions section outside the folder editor cards includes root conversations with a captured workspace ID and normalized folder path matching the saved workspace. Without captured scope, an organizational assignment must match the workspace ID before the original directory matches a saved folder. Unassigned legacy roots retain exact-directory discovery. Active and archived global entities participate. Conversations bound to another workspace never fall back to legacy matching. Live activity comes from the session activity owner.
- The native folder filter defaults to All folders and uses saved folders only. Invalid paths and workspace or runtime changes reset it to All. Filtering changes only the displayed list. Each session ID appears once in source order and shows all matching current folder basenames below its title, including while filtered. Full-path tooltips and full-path select labels disambiguate duplicate basenames. Unsaved folder edits never change discovery.
- Sessions displays 10 filtered rows per page in source order. Previous, Next and the page count appear only above 10 matches. Folder filter, workspace and runtime changes reset to page 1; tab switches retain the page. Shrinking results clamp the stored page so later growth cannot restore an out-of-range selection. Pagination never loads data or changes open membership.
- History discovery performs no writes. Explicit legacy selection awaits assignment through the existing runtime-fenced metadata adapter, then durable open membership, then navigation with restore intent. The metadata updater rechecks the selected saved workspace and its current folders against fresh metadata, refusing competing bindings. Existing captured scopes need no assignment. Runtime or workspace selection changes suppress obsolete navigation. Archive state and original directory remain unchanged. Metadata failure leaves membership and navigation untouched. Membership failure retains the acknowledged assignment and shows the existing open failure for explicit retry, without rollback. Failed loads retain available rows, show Retry, and cannot produce an authoritative empty state.
- After successful history navigation, the mobile sidebar actions provider closes its owning drawer. Shared history reads that provider optionally, so surfaces without a mobile drawer keep the same navigation. Membership failures and stale-runtime completions leave the drawer open.

## Decisions

### Why Base UI owns tab interaction

Base UI Tabs provides linked tabs and panels, roving keyboard focus and locale-aware arrow navigation. The controls reuse the shared recessed pill track and raised selection styling. Kept-mounted history pauses its shared clock while hidden and preserves the parent's existing render callback and filter state.

### Why Scheduled tasks is a tab-triggered page transition

Scheduled tasks is a shared page, not an editor panel. Its real tab opens the existing page, whose initial scope comes from the workspace already selected by the editor. The tab remains selected while that page is open; closing it returns the editor to Home and leaves its unsaved draft untouched.

### Why callbacks own persistence and creation

The overview can be rendered independently of application stores and runtime initialization. Callback rejection leaves the editable data intact; only acknowledged parent props change the saved basis.

### Why unlinking writes immediately

Unlinking is an independent catalog action with its own serialized, acknowledged store operation. The overview waits for the updated workspace props before removing the folder, preserving unrelated edits in its draft when the acknowledged catalog snapshot arrives.

### Why workspace history uses one global projection

The surface derives unique session rows and their matching folder paths in one pass over global entities and their captured scopes. A local filter reuses that projection. Global loading joins the store's existing request; per-folder reads would start unnecessary OpenCode locations and miss archived conversations. Only initial idle state and explicit Retry request loading, so a failed request never creates a retry loop.

### Why pagination follows the folder filter

Local pages slice the filtered global projection into 10 rows, preserving matching, deduplication and ordering. Server pagination would add requests and split discovery ownership away from the global sessions store.

### Why the footer belongs to the navigation shell

Workspace and history are alternate views inside one sidebar, so their actions stay mounted in one shared footer instead of being duplicated in either scrolling view. The history list keeps its own scroller while the shell keeps the footer pinned.

### Why assignment precedes explicit membership

The session metadata owns the organizational association across close and reopen. Acknowledging it before saving the open reference retains its workspace label when ordinary explicit navigation reconstructs that reference. A later membership failure leaves the association valid for retry. All shared runtimes use the existing metadata transport; unsupported writes fail without navigation.
